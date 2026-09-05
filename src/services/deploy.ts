import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  opendir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import type { DeployConfig, SshWpCliConfig } from "../types/config.js";
import { DeployConfigSchema, SshWpCliConfigSchema } from "../types/config.js";
import type { CommandResult, ProcessCommand } from "./wp-cli-transport.js";
import { redactWpCliSecrets } from "./wp-cli-transport.js";

const MAX_FILES = 200_000;
const MAX_BYTES = 32 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const PAYLOAD_NAME = ".__elementor_cli_upload_payload__.json";
export const DEPLOY_SENTINEL = ".elementor-cli-deploy-root.json";
export const RELEASE_METADATA = ".elementor-cli-release.json";
export const RELEASE_COMPLETE = ".elementor-cli-upload-complete.json";

export class DeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployError";
  }
}

export interface DeployManifestFile {
  path: string;
  size: number;
  mode: number;
  sha256: string;
}

export interface DeployManifest {
  schemaVersion: 1;
  files: DeployManifestFile[];
}

export interface SourceInspection {
  sourcePath: string;
  manifest: DeployManifest;
  manifestSha256: string;
  totalBytes: number;
  directories: string[];
  exclusions: string[];
}

export interface GateEvidence {
  kind: "deps-check" | "deps-audit" | "tests";
  sha256: string;
}

export interface DeployPlan {
  schemaVersion: 1;
  command: "deploy plan";
  site: string;
  release: string;
  source: string;
  destination: string;
  livePath: string;
  manifestSha256: string;
  fileCount: number;
  totalBytes: number;
  availableBytes: number;
  files: DeployManifestFile[];
  exclusions: string[];
  gates: GateEvidence[];
  actions: string[];
  mutation: "none";
}

export interface RemoteReleaseStatus {
  name: string;
  state: "incomplete" | "verified" | "current" | "previous" | "invalid";
  manifestSha256?: string;
  reason?: string;
}

export interface DeployStatusResult {
  livePath: string;
  releasesPath: string;
  currentRelease: string | null;
  releases: RemoteReleaseStatus[];
}

const FORBIDDEN_NAMES = [
  /^wp-config\.php$/i,
  /^\.env(?:\..*)?$/i,
  /^\.(?:htpasswd|netrc|npmrc)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /^(?:credentials?|secrets?)(?:\..*)?$/i,
  /\.(?:sql|sqlite|dump)(?:\.(?:gz|bz2|xz|zip))?$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /\.log(?:\.\d+)?$/i,
];
const FORBIDDEN_DIRECTORIES =
  /^(?:quarantine|evidence|forensics?|dumps?|logs?|secrets?)$/i;
const EXCLUDED_NAMES = new Set([".DS_Store", "Thumbs.db"]);
const EXCLUDED_DIRECTORIES = new Set([".git", ".svn", ".hg"]);
const PHP_LIKE = /(?:\.php\d?(?:\.|$)|\.(?:phtml|pht|phar)$)/i;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasUnsafeText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

async function inspectFile(path: string): Promise<{
  size: number;
  mode: number;
  sha256: string;
  containsPhp: boolean;
}> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash("sha256");
  let tail = "";
  let php = false;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > Number.MAX_SAFE_INTEGER) {
      throw new DeployError("Unsupported source file type.");
    }
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      const text = tail + Buffer.from(chunk).toString("latin1");
      if (/<\?(?:php|=)/i.test(text)) php = true;
      tail = text.slice(-8);
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new DeployError(
        "Deploy source changed while its manifest was being created.",
      );
    }
    return {
      size: before.size,
      mode: before.mode & 0o777,
      sha256: hash.digest("hex"),
      containsPhp: php,
    };
  } finally {
    await handle.close();
  }
}

function safeRelativePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    Buffer.byteLength(path) > MAX_PATH_BYTES ||
    hasUnsafeText(path)
  ) {
    throw new DeployError(`Unsafe source path: ${JSON.stringify(path)}`);
  }
}

export async function inspectDeploySource(
  source: string,
): Promise<SourceInspection> {
  const configured = resolve(source);
  let root: string;
  try {
    const sourceStat = await lstat(configured);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink())
      throw new Error();
    root = await realpath(configured);
    if (root !== configured) throw new Error();
  } catch {
    throw new DeployError(
      "Deploy source must be a real, readable directory (not a symlink).",
    );
  }

  for (const required of [
    "index.php",
    "wp-admin",
    "wp-includes",
    "wp-content",
  ]) {
    const requiredPath = join(root, required);
    let requiredStat: Awaited<ReturnType<typeof lstat>>;
    try {
      requiredStat = await lstat(requiredPath);
    } catch {
      throw new DeployError(
        `Source is not a WordPress root: missing ${required}.`,
      );
    }
    const expectedDirectory = required !== "index.php";
    if (
      requiredStat.isSymbolicLink() ||
      (expectedDirectory ? !requiredStat.isDirectory() : !requiredStat.isFile())
    ) {
      throw new DeployError(
        `Source has invalid WordPress root entry: ${required}.`,
      );
    }
  }

  const files: DeployManifestFile[] = [];
  const directories: string[] = [];
  const exclusions: string[] = [];
  let totalBytes = 0;

  async function walk(
    directory: string,
    relativeDirectory = "",
  ): Promise<void> {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      safeRelativePath(relativePath);
      if (
        entry.name === PAYLOAD_NAME ||
        entry.name === RELEASE_METADATA ||
        entry.name === RELEASE_COMPLETE
      ) {
        throw new DeployError(
          `Reserved deploy metadata path is present: ${relativePath}.`,
        );
      }
      if (entry.isSymbolicLink()) {
        throw new DeployError(
          `Symbolic links are not allowed in deploy sources: ${relativePath}.`,
        );
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) {
          exclusions.push(`${relativePath}/`);
          continue;
        }
        if (
          FORBIDDEN_DIRECTORIES.test(entry.name) ||
          entry.name === ".elementor-cli"
        ) {
          throw new DeployError(
            `Forbidden quarantine/evidence directory: ${relativePath}.`,
          );
        }
        const fullPath = join(directory, entry.name);
        const directoryStat = await lstat(fullPath);
        if (
          !directoryStat.isDirectory() ||
          directoryStat.isSymbolicLink() ||
          (await realpath(fullPath)) !== fullPath
        ) {
          throw new DeployError(
            `Symbolic links are not allowed in deploy sources: ${relativePath}.`,
          );
        }
        directories.push(relativePath);
        await walk(fullPath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new DeployError(
          `Unsupported source entry type: ${relativePath}.`,
        );
      }
      if (EXCLUDED_NAMES.has(entry.name)) {
        exclusions.push(relativePath);
        continue;
      }
      if (FORBIDDEN_NAMES.some((pattern) => pattern.test(entry.name))) {
        throw new DeployError(
          `Forbidden secret, dump, or log file: ${relativePath}.`,
        );
      }
      const fullPath = join(directory, entry.name);
      const fileInspection = await inspectFile(fullPath);
      if (
        relativePath.toLowerCase().startsWith("wp-content/uploads/") &&
        (PHP_LIKE.test(entry.name) || fileInspection.containsPhp)
      ) {
        throw new DeployError(
          `PHP-like executable found beneath uploads: ${relativePath}.`,
        );
      }
      totalBytes += fileInspection.size;
      if (files.length >= MAX_FILES || totalBytes > MAX_BYTES) {
        throw new DeployError(
          "Deploy source exceeds the manifest resource limits.",
        );
      }
      files.push({
        path: relativePath,
        size: fileInspection.size,
        mode: fileInspection.mode,
        sha256: fileInspection.sha256,
      });
    }
  }

  await walk(root);
  files.sort((a, b) => compareUtf8(a.path, b.path));
  directories.sort(compareUtf8);
  exclusions.sort(compareUtf8);
  const manifest: DeployManifest = { schemaVersion: 1, files };
  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_MANIFEST_BYTES) {
    throw new DeployError("Deploy manifest exceeds the 64 MiB safety limit.");
  }
  return {
    sourcePath: root,
    manifest,
    manifestSha256: hashJson(manifest),
    totalBytes,
    directories,
    exclusions,
  };
}

export async function validateGateEvidence(
  kind: GateEvidence["kind"],
  path: string,
): Promise<GateEvidence> {
  let bytes: Buffer;
  let record: Record<string, unknown>;
  try {
    const evidenceStat = await lstat(path);
    if (
      !evidenceStat.isFile() ||
      evidenceStat.isSymbolicLink() ||
      evidenceStat.size > 8 * 1024 * 1024
    ) {
      throw new Error();
    }
    bytes = await readFile(path);
    record = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new DeployError(
      `Required ${kind} evidence is missing or invalid JSON.`,
    );
  }
  const successful =
    record.schemaVersion === 1 &&
    ((kind === "deps-check" &&
      record.status === "checked" &&
      typeof record.command === "string" &&
      record.command.endsWith("check") &&
      Array.isArray(record.reports) &&
      !record.reports.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          (item as { status?: unknown }).status === "failed",
      )) ||
      (kind === "deps-audit" &&
        record.command === "deps audit" &&
        record.status === "clean") ||
      (kind === "tests" &&
        record.command === "tests" &&
        record.status === "passed"));
  if (!successful)
    throw new DeployError(`Required ${kind} evidence does not record success.`);
  return { kind, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

// The fixed remote program performs all path and ownership checks itself. Dynamic
// input is base64url JSON, never interpolated into Python or shell syntax.
const REMOTE_PROGRAM = String.raw`
import base64, hashlib, json, os, posixpath, re, shutil, stat, sys, tarfile
SENTINEL='.elementor-cli-deploy-root.json'; META='.elementor-cli-release.json'; COMPLETE='.elementor-cli-upload-complete.json'; PAYLOAD='.__elementor_cli_upload_payload__.json'
def fail(message):
  print(json.dumps({'ok':False,'error':message}, separators=(',',':'))); sys.exit(1)
def contained(root, child): return child.startswith(root + '/') and posixpath.normpath(child) == child
def load_json(path):
  st=os.lstat(path)
  if not stat.S_ISREG(st.st_mode) or st.st_size>64*1024*1024: raise ValueError('metadata is unsafe or exceeds safety limit')
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb') as handle: return json.load(handle)
def validate_base(p):
  live=p['wordpressPath']; releases=p['releasesPath']
  if os.path.realpath(live)!=live or not os.path.isdir(live): fail('configured live path is missing, non-canonical, or a symlink')
  if os.path.realpath(releases)!=releases or not os.path.isdir(releases): fail('configured releases path is missing, non-canonical, or a symlink')
  if contained(live,releases) or contained(releases,live) or live==releases: fail('live and releases paths are not disjoint')
  marker=posixpath.join(releases,SENTINEL); ds=os.stat(releases); ms=os.lstat(marker)
  if not stat.S_ISREG(ms.st_mode) or ms.st_uid!=os.geteuid() or ds.st_uid!=os.geteuid() or stat.S_IMODE(ms.st_mode)&0o022 or stat.S_IMODE(ds.st_mode)&0o022: fail('deploy sentinel or releases directory has unsafe ownership or permissions')
  expected={'schemaVersion':1,'wordpressPath':live,'releasesPath':releases}
  if load_json(marker)!=expected: fail('deploy sentinel does not match configured paths')
  return live,releases
def digest(path):
  h=hashlib.sha256()
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb') as f:
    for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
  return h.hexdigest()
def verify_release(path, metadata, require_owner=True):
  if os.path.realpath(path)!=path or not os.path.isdir(path) or (require_owner and os.stat(path).st_uid!=os.geteuid()): return False,'release path or ownership is invalid'
  manifest=metadata.get('manifest'); expected=manifest.get('files') if isinstance(manifest,dict) else None
  if not isinstance(expected,list) or hashlib.sha256(json.dumps(manifest,separators=(',',':'),ensure_ascii=False,sort_keys=True).encode()).hexdigest()!=metadata.get('manifestSha256'): return False,'invalid manifest metadata'
  wanted=set()
  for item in expected:
    rel=item.get('path',''); target=posixpath.join(path,rel)
    if not rel or rel.startswith('/') or '..' in rel.split('/') or not contained(path,target): return False,'unsafe manifest path'
    try: st=os.lstat(target)
    except OSError: return False,'manifest file missing'
    if not stat.S_ISREG(st.st_mode) or st.st_size!=item.get('size') or stat.S_IMODE(st.st_mode)!=item.get('mode') or digest(target)!=item.get('sha256'): return False,'file verification failed'
    wanted.add(rel)
  actual=set(); actual_dirs=set()
  for root,dirs,files in os.walk(path,followlinks=False):
    if any(os.path.islink(posixpath.join(root,n)) for n in dirs+files): return False,'symbolic link in release'
    for name in dirs: actual_dirs.add(posixpath.relpath(posixpath.join(root,name),path))
    for name in files:
      rel=posixpath.relpath(posixpath.join(root,name),path)
      if rel not in (META,COMPLETE): actual.add(rel)
  if actual!=wanted: return False,'release file set differs from manifest'
  if actual_dirs!=set(metadata.get('directories',[])): return False,'release directory set differs from metadata'
  return True,''
def preflight(p):
  live,releases=validate_base(p); release=p['release']; final=posixpath.join(releases,release)
  if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}',release): fail('invalid release identity')
  if not contained(releases,final): fail('release path escapes releases root')
  if os.path.lexists(final): fail('release already exists')
  free=shutil.disk_usage(releases).free
  if free < p['requiredBytes']: fail('insufficient remote disk space')
  return {'ok':True,'availableBytes':free,'livePath':live,'releasesPath':releases}
def upload():
  tf=tarfile.open(fileobj=sys.stdin.buffer,mode='r|*'); first=tf.next()
  if first is None or first.name!=PAYLOAD or not first.isfile() or first.size>64*1024*1024: fail('upload payload is missing or too large')
  p=json.load(tf.extractfile(first)); live,releases=validate_base(p); release=p['release']; temporary=p['temporary']
  if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}',release) or not re.fullmatch(r'\.uploading-[A-Za-z0-9._-]{1,180}',temporary): fail('invalid release identity')
  final=posixpath.join(releases,release); temp=posixpath.join(releases,temporary)
  if not contained(releases,final) or not contained(releases,temp): fail('upload path escapes releases root')
  if os.path.lexists(final) or os.path.lexists(temp): fail('release or temporary path already exists')
  if shutil.disk_usage(releases).free < p['requiredBytes']: fail('insufficient remote disk space')
  os.mkdir(temp,0o700)
  try:
    expected={item['path']:item for item in p['manifest']['files']}; expected_dirs=set(p['directories']); seen=set(); seen_dirs=set()
    while True:
      member=tf.next()
      if member is None: break
      name=member.name.rstrip('/')
      if not name or name.startswith('/') or '..' in name.split('/'): raise ValueError('unsafe archive path')
      target=posixpath.join(temp,name)
      if not contained(temp,target): raise ValueError('archive path escapes temporary release')
      if member.isdir():
        if name not in expected_dirs or name in seen_dirs: raise ValueError('unexpected archive directory')
        os.makedirs(target,exist_ok=True); seen_dirs.add(name); continue
      if not member.isfile() or name not in expected or name in seen or member.size!=expected[name]['size']: raise ValueError('unexpected archive entry')
      os.makedirs(posixpath.dirname(target),exist_ok=True); source=tf.extractfile(member)
      with open(target,'xb') as output: shutil.copyfileobj(source,output,1024*1024)
      os.chmod(target,expected[name]['mode']); seen.add(name)
    if seen!=set(expected) or seen_dirs!=expected_dirs: raise ValueError('archive file set is incomplete')
    metadata={'schemaVersion':1,'release':release,'site':p['site'],'manifestSha256':p['manifestSha256'],'manifest':p['manifest'],'directories':p['directories'],'gates':p['gates']}
    good,reason=verify_release(temp,metadata)
    if not good: raise ValueError(reason)
    with open(posixpath.join(temp,META),'x',encoding='utf8') as f: json.dump(metadata,f,separators=(',',':'),sort_keys=True)
    with open(posixpath.join(temp,COMPLETE),'x',encoding='utf8') as f: json.dump({'schemaVersion':1,'manifestSha256':p['manifestSha256']},f,separators=(',',':'),sort_keys=True)
    os.rename(temp,final)
    print(json.dumps({'ok':True,'release':release,'manifestSha256':p['manifestSha256']},separators=(',',':')))
  except BaseException as error:
    validate_base(p)
    if contained(releases,temp) and os.path.isdir(temp) and not os.path.islink(temp): shutil.rmtree(temp)
    fail('upload verification failed: '+str(error))
def status(p):
  live,releases=validate_base(p); current=None
  try:
    lm=load_json(posixpath.join(live,META)); live_good,_=verify_release(live,lm,False)
    current=lm.get('release') if lm.get('schemaVersion')==1 and live_good else None
  except Exception: pass
  rows=[]
  for name in sorted(os.listdir(releases)):
    path=posixpath.join(releases,name)
    if name==SENTINEL: continue
    if os.path.islink(path): rows.append({'name':name,'state':'invalid','reason':'symbolic-link release entry'}); continue
    if not os.path.isdir(path): continue
    if name.startswith('.uploading-'): rows.append({'name':name,'state':'incomplete','reason':'temporary upload has no completion evidence'}); continue
    try:
      metadata=load_json(posixpath.join(path,META)); complete=load_json(posixpath.join(path,COMPLETE))
      if complete!={'schemaVersion':1,'manifestSha256':metadata.get('manifestSha256')}: raise ValueError('completion marker mismatch')
      good,reason=verify_release(path,metadata)
      if not good: raise ValueError(reason)
      state='current' if name==current else ('previous' if metadata.get('publishedAt') else 'verified')
      rows.append({'name':name,'state':state,'manifestSha256':metadata['manifestSha256']})
    except Exception as error: rows.append({'name':name,'state':'invalid','reason':str(error)})
  print(json.dumps({'ok':True,'livePath':live,'releasesPath':releases,'currentRelease':current,'releases':rows},separators=(',',':')))
try:
  operation=sys.argv[1]
  if operation=='upload': upload()
  else:
    p=json.loads(base64.urlsafe_b64decode(sys.argv[2]+'==='))
    print(json.dumps(preflight(p),separators=(',',':'))) if operation=='preflight' else status(p)
except SystemExit: raise
except BaseException as error: fail(str(error))
`;

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function buildDeploySshCommand(
  sshInput: SshWpCliConfig,
  operation: "preflight" | "upload" | "status",
  payload?: unknown,
): ProcessCommand {
  const ssh = SshWpCliConfigSchema.parse(sshInput);
  const remote = ["python3", "-c", REMOTE_PROGRAM, operation];
  if (payload !== undefined) remote.push(encodePayload(payload));
  return {
    executable: "ssh",
    args: [
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "PasswordAuthentication=no",
      "-o",
      "KbdInteractiveAuthentication=no",
      "-o",
      "PreferredAuthentications=publickey",
      "--",
      ssh.host,
      remote.map(shellQuote).join(" "),
    ],
  };
}

type DeployRunner = (
  command: ProcessCommand,
  stdin?: Readable,
) => Promise<CommandResult>;

const MAX_REMOTE_OUTPUT = 8 * 1024 * 1024;

const runDeployProcess: DeployRunner = (command, stdin) =>
  new Promise((resolveResult, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_REMOTE_OUTPUT && !settled) {
        settled = true;
        child.kill();
        reject(
          new DeployError("Remote deploy response exceeded the safety limit."),
        );
      } else {
        stdout.push(chunk);
      }
    });
    // Remote stderr is deliberately discarded: it is untrusted and can contain
    // credentials or terminal controls. Structured stdout carries safe errors.
    child.stderr.resume();
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(
          new DeployError(
            `Unable to start SSH deploy transport: ${error.message}`,
          ),
        );
      }
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && !settled) {
        settled = true;
        reject(
          new DeployError("Unable to stream the deploy archive over SSH."),
        );
      }
    });
    child.on("close", (exitCode) => {
      if (!settled) {
        settled = true;
        resolveResult({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: "",
          exitCode: exitCode ?? 1,
        });
      }
    });
    if (stdin) {
      stdin.on("error", () => {
        if (!settled) {
          settled = true;
          child.kill();
          reject(new DeployError("Unable to read the local deploy archive."));
        }
      });
      stdin.pipe(child.stdin);
    } else child.stdin.end();
  });

function safeRemoteText(value: unknown, label: string, maximum = 4096): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > maximum ||
    hasUnsafeText(value)
  ) {
    throw new DeployError(`Remote ${label} is invalid.`);
  }
  return value;
}

function safeReleaseName(value: unknown, label = "release name"): string {
  const name = safeRemoteText(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
    throw new DeployError(`Remote ${label} is invalid.`);
  }
  return name;
}

function parseRemoteResult(result: CommandResult): Record<string, unknown> {
  if (Buffer.byteLength(result.stdout) > MAX_REMOTE_OUTPUT) {
    throw new DeployError("Remote deploy response exceeded the safety limit.");
  }
  let output: Record<string, unknown>;
  try {
    output = JSON.parse(result.stdout.trim());
  } catch {
    throw new DeployError("Remote deploy helper returned an invalid response.");
  }
  if (result.exitCode !== 0 || output.ok !== true) {
    const reason =
      typeof output.error === "string"
        ? safeRemoteText(output.error, "error")
        : "remote operation failed";
    throw new DeployError(redactWpCliSecrets(reason));
  }
  return output;
}

export class DeploySshClient {
  private readonly ssh: SshWpCliConfig;

  constructor(
    ssh: SshWpCliConfig,
    private readonly runner: DeployRunner = runDeployProcess,
  ) {
    this.ssh = SshWpCliConfigSchema.parse(ssh);
  }

  async preflight(
    deployInput: DeployConfig,
    release: string,
    requiredBytes: number,
  ): Promise<{
    availableBytes: number;
    livePath: string;
    releasesPath: string;
  }> {
    const deploy = DeployConfigSchema.parse(deployInput);
    const output = parseRemoteResult(
      await this.runner(
        buildDeploySshCommand(this.ssh, "preflight", {
          ...deploy,
          release,
          requiredBytes,
        }),
      ),
    );
    if (
      !Number.isSafeInteger(output.availableBytes) ||
      (output.availableBytes as number) < 0 ||
      output.livePath !== deploy.wordpressPath ||
      output.releasesPath !== deploy.releasesPath
    ) {
      throw new DeployError("Remote preflight response is invalid.");
    }
    return output as unknown as {
      availableBytes: number;
      livePath: string;
      releasesPath: string;
    };
  }

  async status(deployInput: DeployConfig): Promise<DeployStatusResult> {
    const deploy = DeployConfigSchema.parse(deployInput);
    const output = parseRemoteResult(
      await this.runner(buildDeploySshCommand(this.ssh, "status", deploy)),
    );
    if (
      output.livePath !== deploy.wordpressPath ||
      output.releasesPath !== deploy.releasesPath ||
      !Array.isArray(output.releases) ||
      output.releases.length > MAX_FILES
    )
      throw new DeployError("Remote status response is invalid.");
    const currentRelease =
      output.currentRelease === null
        ? null
        : safeReleaseName(output.currentRelease, "current release");
    const states = new Set([
      "incomplete",
      "verified",
      "current",
      "previous",
      "invalid",
    ]);
    const releases = output.releases.map((item): RemoteReleaseStatus => {
      if (!item || typeof item !== "object") {
        throw new DeployError("Remote status response is invalid.");
      }
      const row = item as Record<string, unknown>;
      const name = safeRemoteText(row.name, "release name", 256);
      if (
        !/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}|\.uploading-[A-Za-z0-9._-]{1,180})$/.test(
          name,
        ) ||
        typeof row.state !== "string" ||
        !states.has(row.state)
      ) {
        throw new DeployError("Remote status response is invalid.");
      }
      const manifestSha256 =
        row.manifestSha256 === undefined
          ? undefined
          : safeRemoteText(row.manifestSha256, "manifest digest", 64);
      if (manifestSha256 && !/^[a-f0-9]{64}$/.test(manifestSha256)) {
        throw new DeployError("Remote status response is invalid.");
      }
      const reason =
        row.reason === undefined
          ? undefined
          : safeRemoteText(row.reason, "status reason");
      return {
        name,
        state: row.state as RemoteReleaseStatus["state"],
        ...(manifestSha256 ? { manifestSha256 } : {}),
        ...(reason ? { reason } : {}),
      };
    });
    return {
      livePath: deploy.wordpressPath,
      releasesPath: deploy.releasesPath,
      currentRelease,
      releases,
    };
  }

  async upload(archivePath: string): Promise<Record<string, unknown>> {
    return parseRemoteResult(
      await this.runner(
        buildDeploySshCommand(this.ssh, "upload"),
        createReadStream(archivePath),
      ),
    );
  }
}

function validateReleaseName(name: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new DeployError(
      "Release name must be 1-128 safe identifier characters.",
    );
  }
  return name;
}

export function releaseNameFor(
  manifestSha256: string,
  requested?: string,
): string {
  return validateReleaseName(
    requested ?? `release-${manifestSha256.slice(0, 16)}`,
  );
}

export async function createUploadArchive(
  inspection: SourceInspection,
  payload: Record<string, unknown>,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "elementor-cli-deploy-"));
  const payloadPath = join(directory, PAYLOAD_NAME);
  const archivePath = join(directory, "upload.tar");
  const entries = [
    ...inspection.directories,
    ...inspection.manifest.files.map((file) => file.path),
  ];
  const command = [
    "tar",
    "--format=pax",
    "--null",
    "--no-recursion",
    "-cf",
    archivePath,
    "-C",
    directory,
    PAYLOAD_NAME,
    "-C",
    inspection.sourcePath,
    "--files-from=-",
  ];
  try {
    await writeFile(payloadPath, JSON.stringify(payload), { mode: 0o600 });
    const result = await new Promise<number>((resolveResult, reject) => {
      const child = spawn(command[0], command.slice(1), {
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.on("error", reject);
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") reject(error);
      });
      child.on("close", (code) => resolveResult(code ?? 1));
      child.stdin.end(`${entries.join("\0")}\0`);
    });
    if (result !== 0) throw new Error("tar failed");
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new DeployError("Unable to create the argument-safe upload archive.");
  }
  return {
    path: archivePath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function assertSourceUnchanged(
  original: SourceInspection,
): Promise<void> {
  const current = await inspectDeploySource(original.sourcePath);
  if (current.manifestSha256 !== original.manifestSha256) {
    throw new DeployError(
      "Deploy source changed after planning; upload was aborted.",
    );
  }
}

export function remotePayload(
  site: string,
  deploy: DeployConfig,
  release: string,
  inspection: SourceInspection,
  gates: GateEvidence[],
) {
  return {
    ...deploy,
    site,
    release,
    temporary: `.uploading-${release}-${randomUUID()}`,
    requiredBytes:
      inspection.totalBytes +
      Buffer.byteLength(JSON.stringify(inspection.manifest)) +
      16 * 1024 * 1024,
    manifestSha256: inspection.manifestSha256,
    manifest: inspection.manifest,
    directories: inspection.directories,
    gates,
  };
}
