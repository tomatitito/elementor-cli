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
import {
  DeployConfigSchema,
  DeployPublishConfigSchema,
  SshWpCliConfigSchema,
} from "../types/config.js";
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
export const PUBLICATION_RECORD = "publication.json";

export const PUBLISH_STEPS = [
  "preflight",
  "maintenance-enabled",
  "files-backed-up",
  "database-backed-up",
  "backups-validated",
  "config-provisioned",
  "previous-release-moved",
  "candidate-live",
  "database-imported",
  "caches-cleared",
  "dependency-check-audit-passed",
  "smoke-checks-passed",
  "maintenance-disabled",
  "completed",
] as const;
export type PublishStep = (typeof PUBLISH_STEPS)[number];

export function assertPublishTransition(
  completed: readonly PublishStep[],
  next: PublishStep,
  databaseRequested: boolean,
): void {
  const expected = PUBLISH_STEPS.filter(
    (step) => databaseRequested || step !== "database-imported",
  );
  if (
    completed.length >= expected.length ||
    completed.some((step, index) => step !== expected[index]) ||
    next !== expected[completed.length]
  ) {
    throw new DeployError(`Invalid publish state transition to '${next}'.`);
  }
}

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
  maintenanceActive: boolean;
  lockActive: boolean;
  publications: RemotePublicationStatus[];
  releases: RemoteReleaseStatus[];
}

export interface RemotePublicationStatus {
  id: string;
  release: string;
  status: "publishing" | "completed" | "failed" | "rolled-back";
  createdAt: string;
  failedStep?: string;
  rollbackStatus?: string;
}

export interface PublishResult {
  publicationId: string;
  release: string;
  status: "completed" | "failed" | "rolled-back";
  completedSteps: string[];
  maintenanceActive: boolean;
  livePath: string;
  currentRelease: string | null;
  failedStep?: string;
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
import base64, hashlib, json, os, posixpath, re, shutil, stat, subprocess, sys, tarfile, urllib.parse, urllib.request, uuid
from datetime import datetime, timezone
SENTINEL='.elementor-cli-deploy-root.json'; META='.elementor-cli-release.json'; COMPLETE='.elementor-cli-upload-complete.json'; PAYLOAD='.__elementor_cli_upload_payload__.json'; RECORD='publication.json'; LOCK='.elementor-cli-publish.lock'
PUBLISH_STEPS=['preflight','maintenance-enabled','files-backed-up','database-backed-up','backups-validated','config-provisioned','previous-release-moved','candidate-live','database-imported','caches-cleared','dependency-check-audit-passed','smoke-checks-passed','maintenance-disabled','completed']
def fail(message):
  print(json.dumps({'ok':False,'error':message}, separators=(',',':'))); sys.exit(1)
def contained(root, child): return child.startswith(root + '/') and posixpath.normpath(child) == child
def load_json(path):
  st=os.lstat(path)
  if not stat.S_ISREG(st.st_mode) or st.st_size>64*1024*1024: raise ValueError('metadata is unsafe or exceeds safety limit')
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb') as handle: return json.load(handle)
def validate_base(p, allow_missing_live=False):
  live=p['wordpressPath']; releases=p['releasesPath']; publish_keys=('backupsPath','configSourcePath','maintenancePath','wpCliPath'); publishing=all(p.get(key) for key in publish_keys); backups=p.get('backupsPath')
  if (not allow_missing_live or os.path.lexists(live)) and (os.path.realpath(live)!=live or not os.path.isdir(live)): fail('configured live path is missing, non-canonical, or a symlink')
  if os.path.realpath(releases)!=releases or not os.path.isdir(releases): fail('configured releases path is missing, non-canonical, or a symlink')
  if publishing and (os.path.realpath(backups)!=backups or not os.path.isdir(backups)): fail('configured backups path is missing, non-canonical, or a symlink')
  roots=(live,releases,backups) if publishing else (live,releases)
  if any(a==b or contained(a,b) or contained(b,a) for i,a in enumerate(roots) for b in roots[i+1:]): fail('deploy roots are not disjoint')
  for root in roots:
    parent=posixpath.dirname(root); ps=os.stat(parent)
    if os.path.realpath(parent)!=parent or not os.path.isdir(parent) or ps.st_uid not in (0,os.geteuid()) or stat.S_IMODE(ps.st_mode)&0o022: fail('deploy root parent has unsafe ownership or permissions')
  marker=posixpath.join(releases,SENTINEL); ds=os.stat(releases); ms=os.lstat(marker); unsafe=not stat.S_ISREG(ms.st_mode) or ms.st_uid!=os.geteuid() or ds.st_uid!=os.geteuid() or stat.S_IMODE(ms.st_mode)&0o022 or stat.S_IMODE(ds.st_mode)&0o022
  if publishing: unsafe=unsafe or os.stat(backups).st_uid!=os.geteuid() or stat.S_IMODE(os.stat(backups).st_mode)&0o077
  if unsafe: fail('deploy sentinel or deploy directories have unsafe ownership or permissions')
  expected={key:p[key] for key in ('wordpressPath','releasesPath')}; expected['schemaVersion']=1
  if publishing: expected={key:p[key] for key in ('wordpressPath','releasesPath','backupsPath','configSourcePath','maintenancePath','wpCliPath')} | {'schemaVersion':2}
  if load_json(marker)!=expected: fail('deploy sentinel does not match configured paths')
  return live,releases,backups
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
      if rel not in (META,COMPLETE) and not (rel=='wp-config.php' and metadata.get('publicationId')): actual.add(rel)
  if actual!=wanted: return False,'release file set differs from manifest'
  if actual_dirs!=set(metadata.get('directories',[])): return False,'release directory set differs from metadata'
  return True,''
def preflight(p):
  live,releases,_=validate_base(p); release=p['release']; final=posixpath.join(releases,release)
  if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}',release): fail('invalid release identity')
  if not contained(releases,final): fail('release path escapes releases root')
  if os.path.lexists(final): fail('release already exists')
  free=shutil.disk_usage(releases).free
  if free < p['requiredBytes']: fail('insufficient remote disk space')
  return {'ok':True,'availableBytes':free,'livePath':live,'releasesPath':releases}
def upload():
  tf=tarfile.open(fileobj=sys.stdin.buffer,mode='r|*'); first=tf.next()
  if first is None or first.name!=PAYLOAD or not first.isfile() or first.size>64*1024*1024: fail('upload payload is missing or too large')
  p=json.load(tf.extractfile(first)); live,releases,_=validate_base(p); release=p['release']; temporary=p['temporary']
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
def safe_id(value,prefix):
  pattern=prefix+r'[A-Za-z0-9][A-Za-z0-9._-]{0,119}'
  if not isinstance(value,str) or not re.fullmatch(pattern,value): raise ValueError('invalid operation identity')
  return value
def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def atomic_json(path,value):
  temporary=path+'.tmp-'+uuid.uuid4().hex
  fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w',encoding='utf8') as handle:
    json.dump(value,handle,separators=(',',':'),sort_keys=True); handle.flush(); os.fsync(handle.fileno())
  os.replace(temporary,path)
  directory=os.open(posixpath.dirname(path),os.O_RDONLY); os.fsync(directory); os.close(directory)
def secure_file(path,executable=False):
  st=os.lstat(path)
  if not stat.S_ISREG(st.st_mode) or os.path.realpath(path)!=path or st.st_uid not in (0,os.geteuid()) or stat.S_IMODE(st.st_mode)&0o022 or (not executable and stat.S_IMODE(st.st_mode)&0o077): raise ValueError('protected server-side file is unsafe')
  parent=os.stat(posixpath.dirname(path))
  if parent.st_uid not in (0,os.geteuid()) or stat.S_IMODE(parent.st_mode)&0o022: raise ValueError('protected server-side file parent is unsafe')
  if executable and not os.access(path,os.X_OK): raise ValueError('configured WP-CLI binary is not executable')
def copy_protected_config(source,target):
  secure_file(source); source_fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW); before=os.fstat(source_fd)
  target_fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:
    with os.fdopen(source_fd,'rb',closefd=False) as input_file, os.fdopen(target_fd,'wb',closefd=False) as output_file:
      shutil.copyfileobj(input_file,output_file,1024*1024); output_file.flush(); os.fsync(output_file.fileno())
    after=os.fstat(source_fd)
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns): raise ValueError('protected config changed while provisioning')
  finally: os.close(source_fd); os.close(target_fd)
def exact_wordpress_root(path):
  for name,want_dir in (('index.php',False),('wp-admin',True),('wp-includes',True),('wp-content',True)):
    target=posixpath.join(path,name); st=os.lstat(target)
    if os.path.islink(target) or (stat.S_ISDIR(st.st_mode) if want_dir else stat.S_ISREG(st.st_mode)) is False: raise ValueError('release does not have the exact WordPress-root layout')
def tree_digest(path):
  h=hashlib.sha256(); total=0
  for root,dirs,files in os.walk(path,followlinks=False):
    dirs.sort(); files.sort()
    if any(os.path.islink(posixpath.join(root,n)) for n in dirs+files): raise ValueError('symbolic link in file snapshot')
    for name in files:
      rel=posixpath.relpath(posixpath.join(root,name),path)
      if any(ord(c)<32 or 127<=ord(c)<=159 for c in rel): raise ValueError('unsafe filename in file snapshot')
      target=posixpath.join(root,name); st=os.lstat(target)
      if not stat.S_ISREG(st.st_mode): raise ValueError('non-regular file in file snapshot')
      total+=st.st_size; h.update(rel.encode()+b'\0'+str(stat.S_IMODE(st.st_mode)).encode()+b'\0'+str(st.st_size).encode()+b'\0'+digest(target).encode()+b'\0')
  return h.hexdigest(),total
def run_wp(p,root,args,plugins=False):
  command=[p['wpCliPath'],'--path='+root,'--no-color']
  if not plugins: command+=['--skip-plugins','--skip-themes']
  result=subprocess.run(command+args,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=600)
  if result.returncode!=0: raise ValueError('WP-CLI operation failed')
def database_size(p,root):
  command=[p['wpCliPath'],'--path='+root,'--no-color','--skip-plugins','--skip-themes','db','size','--size_format=b']
  result=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=120)
  if result.returncode!=0 or len(result.stdout)>128: raise ValueError('unable to determine database backup capacity')
  text=result.stdout.decode('ascii','strict').strip()
  if not re.fullmatch(r'[0-9]+',text): raise ValueError('database size evidence is invalid')
  size=int(text)
  if size<1 or size>1024*1024*1024*1024: raise ValueError('database size evidence is outside safety limits')
  return size
def backup_database(p,root,path):
  run_wp(p,root,['db','export',path,'--add-drop-table'])
  st=os.lstat(path)
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or os.path.islink(path): raise ValueError('database backup is unsafe')
  os.chmod(path,0o600); secure_file(path); return digest(path)
def import_database(p,root,path): run_wp(p,root,['db','import',path])
def cache_and_checks(p,root):
  run_wp(p,root,['cache','flush'])
  run_wp(p,root,['elementor','flush_css'],True)
  run_wp(p,root,['core','verify-checksums'])
  run_wp(p,root,['plugin','verify-checksums','--all','--strict'])
  run_wp(p,root,['theme','verify-checksums','--all','--strict'])
def smoke(p):
  results=[]
  for url in p['smokeUrls']:
    parsed=urllib.parse.urlsplit(url) if isinstance(url,str) else None
    if not parsed or parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment: raise ValueError('unsafe smoke-check URL')
    request=urllib.request.Request(url,headers={'User-Agent':'elementor-cli-deploy-smoke/1'})
    with urllib.request.urlopen(request,timeout=20) as response:
      if response.status<200 or response.status>=400 or not response.geturl().startswith('https://'): raise ValueError('HTTP smoke check failed')
      response.read(1024*1024+1)
      results.append({'urlSha256':hashlib.sha256(url.encode()).hexdigest(),'status':response.status})
  return results
def maintenance(p,enabled):
  path=p['maintenancePath']; parent=posixpath.dirname(path)
  if os.path.realpath(parent)!=parent or not os.path.isdir(parent) or os.stat(parent).st_uid not in (0,os.geteuid()) or stat.S_IMODE(os.stat(parent).st_mode)&0o022: raise ValueError('maintenance marker parent is unsafe')
  if enabled:
    if os.path.lexists(path):
      st=os.lstat(path)
      if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)&0o022: raise ValueError('maintenance marker is unsafe')
      return
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
    with os.fdopen(fd,'w') as handle: handle.write('Service temporarily unavailable\n'); handle.flush(); os.fsync(handle.fileno())
  elif os.path.lexists(path):
    st=os.lstat(path)
    if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)&0o022: raise ValueError('maintenance marker is unsafe')
    os.unlink(path)
def release_evidence(releases,release):
  path=posixpath.join(releases,release)
  metadata=load_json(posixpath.join(path,META)); complete=load_json(posixpath.join(path,COMPLETE))
  if complete!={'schemaVersion':1,'manifestSha256':metadata.get('manifestSha256')}: raise ValueError('release completion marker mismatch')
  good,reason=verify_release(path,metadata)
  if not good: raise ValueError(reason)
  gates=metadata.get('gates'); gate_kinds={item.get('kind') for item in gates if isinstance(item,dict) and re.fullmatch(r'[a-f0-9]{64}',item.get('sha256',''))} if isinstance(gates,list) else set()
  if not {'deps-check','deps-audit'}.issubset(gate_kinds): raise ValueError('release lacks required dependency check and audit evidence')
  exact_wordpress_root(path)
  forbidden=('wp-config.php','.env','quarantine','evidence','forensics','dump')
  for item in metadata['manifest']['files']:
    lower=item['path'].lower(); name=posixpath.basename(lower)
    if name=='wp-config.php' or name.startswith('.env') or name.endswith(('.sql','.sql.gz','.dump')) or any(part in forbidden for part in lower.split('/')): raise ValueError('release contains forbidden secret, quarantine, dump, or config content')
    if lower.startswith('wp-content/uploads/') and re.search(r'\.(php\d?|phtml|pht|phar)(\.|$)',name): raise ValueError('release contains executable content beneath uploads')
  return path,metadata
def common_publish_preflight(p,rollback=False):
  live,releases,backups=validate_base(p,rollback); secure_file(p['configSourcePath']); secure_file(p['wpCliPath'],True)
  exact_wordpress_root(live) if os.path.isdir(live) else None
  if os.path.isdir(live):
    ls=os.stat(live); ps=os.stat(posixpath.dirname(live))
    if ls.st_uid!=os.geteuid() or ps.st_uid!=os.geteuid() or stat.S_IMODE(ls.st_mode)&0o022 or stat.S_IMODE(ps.st_mode)&0o022: raise ValueError('live root or parent has unsafe ownership or permissions')
  if os.stat(posixpath.dirname(live)).st_dev!=os.stat(releases).st_dev: raise ValueError('live and releases paths do not support same-filesystem rename')
  if not rollback and os.path.lexists(p['maintenancePath']): raise ValueError('maintenance is already active')
  if os.path.lexists(posixpath.join(backups,LOCK)): raise ValueError('another publish or rollback holds the deployment lock')
  return live,releases,backups
def publication_rows(backups):
  rows=[]
  for name in sorted(os.listdir(backups)):
    directory=posixpath.join(backups,name); path=posixpath.join(directory,RECORD)
    if not re.fullmatch(r'pub-[A-Za-z0-9._-]{1,120}',name) or not os.path.isfile(path) or os.path.islink(path): continue
    try:
      secure_publication_dir(directory)
      record=load_json(path)
      if record.get('id')!=name or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}',record.get('release','')) or record.get('status') not in ('publishing','completed','failed','rolled-back'): continue
      rows.append({key:record[key] for key in ('id','release','status','createdAt')} | {key:record[key] for key in ('failedStep','rollbackStatus') if key in record})
    except Exception: continue
  return rows
def validate_database_evidence(p):
  requested=p.get('databaseRequested'); size=p.get('databaseSize')
  if not isinstance(requested,bool) or not isinstance(size,int) or isinstance(size,bool): raise ValueError('sanitized database evidence is invalid')
  if requested and (size<1 or size>32*1024*1024*1024 or not re.fullmatch(r'[a-f0-9]{64}',p.get('databaseSha256',''))): raise ValueError('sanitized database evidence is invalid')
  if not requested and size!=0: raise ValueError('unexpected database input evidence')
def publish_preflight(p):
  validate_database_evidence(p); live,releases,backups=common_publish_preflight(p); release=safe_id(p['release'],r''); site=safe_id(p['site'],r'')
  candidate,metadata=release_evidence(releases,release); _,live_bytes=tree_digest(live); live_database_bytes=database_size(p,live)
  if metadata.get('site')!=site: raise ValueError('release site identity does not match publication target')
  required=live_bytes*2+live_database_bytes*2+p.get('databaseSize',0)+64*1024*1024
  if shutil.disk_usage(backups).free<required: raise ValueError('insufficient backup capacity')
  return {'ok':True,'release':release,'manifestSha256':metadata['manifestSha256'],'requiredBytes':required,'availableBytes':shutil.disk_usage(backups).free,'livePath':live,'maintenanceActive':False,'actions':['enable external maintenance','create and validate matching file and database backups','provision protected server-side config','rename live and candidate directories','optionally import explicitly supplied sanitized database','clear caches; run dependency check/audit and HTTPS smoke checks','disable maintenance and record publication']}
def acquire(backups): os.mkdir(posixpath.join(backups,LOCK),0o700)
def secure_publication_dir(path):
  st=os.lstat(path)
  if not stat.S_ISDIR(st.st_mode) or os.path.realpath(path)!=path or st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)&0o077: raise ValueError('publication directory is unsafe')
def release_lock(backups):
  path=posixpath.join(backups,LOCK)
  if os.path.isdir(path) and not os.path.islink(path): os.rmdir(path)
def publish(p):
  validate_database_evidence(p); publication=safe_id(p['publicationId'],r'pub-'); release=safe_id(p['release'],r''); site=safe_id(p['site'],r''); live,releases,backups=validate_base(p); publication_dir=posixpath.join(backups,publication)
  if os.path.lexists(publication_dir):
    secure_publication_dir(publication_dir)
    old=load_json(posixpath.join(publication_dir,RECORD))
    if old.get('status')=='completed': return result_record(p,old)
    raise ValueError('publication identity already has ambiguous or failed state')
  live,releases,backups=common_publish_preflight(p); candidate,metadata=release_evidence(releases,release)
  if metadata.get('site')!=site: raise ValueError('release site identity does not match publication target')
  acquire(backups)
  record={'schemaVersion':1,'id':publication,'release':release,'site':p['site'],'status':'publishing','createdAt':now(),'manifestSha256':metadata['manifestSha256'],'databaseRequested':bool(p.get('databaseRequested')),'completedSteps':['preflight']}
  failed_step='initialize-publication'
  try: os.mkdir(publication_dir,0o700); atomic_json(posixpath.join(publication_dir,RECORD),record)
  except BaseException:
    release_lock(backups); raise
  def step(name):
    expected=[item for item in PUBLISH_STEPS if record['databaseRequested'] or item!='database-imported']
    if record['completedSteps']!=expected[:len(record['completedSteps'])] or name!=expected[len(record['completedSteps'])]: raise ValueError('invalid publication state transition')
    record['completedSteps'].append(name); atomic_json(posixpath.join(publication_dir,RECORD),record)
  try:
    database_input=None
    if record['databaseRequested']:
      failed_step='receive-sanitized-database'; database_input=posixpath.join(publication_dir,'sanitized-input.sql')
      remaining=p['databaseSize']; h=hashlib.sha256(); fd=os.open(database_input,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
      with os.fdopen(fd,'wb') as output:
        while remaining:
          chunk=sys.stdin.buffer.read(min(1024*1024,remaining))
          if not chunk: raise ValueError('sanitized database input is incomplete')
          output.write(chunk); h.update(chunk); remaining-=len(chunk)
        output.flush(); os.fsync(output.fileno())
      if sys.stdin.buffer.read(1) or h.hexdigest()!=p['databaseSha256']: raise ValueError('sanitized database input hash mismatch')
    failed_step='enable-maintenance'; maintenance(p,True); step('maintenance-enabled')
    failed_step='backup-files'; files=posixpath.join(publication_dir,'files'); live_hash,live_bytes=tree_digest(live)
    required=live_bytes*2+database_size(p,live)*2+p.get('databaseSize',0)+64*1024*1024
    if shutil.disk_usage(backups).free<required: raise ValueError('backup capacity changed after preflight')
    shutil.copytree(live,files,symlinks=False); backup_hash,_=tree_digest(files)
    if backup_hash!=live_hash: raise ValueError('file backup validation failed')
    record['fileBackupIdentifier']=publication+'/files'; record['fileBackupSha256']=backup_hash; step('files-backed-up')
    failed_step='backup-database'; database_backup=posixpath.join(publication_dir,'database.sql'); database_hash=backup_database(p,live,database_backup)
    record['databaseBackupIdentifier']=publication+'/database.sql'; record['databaseBackupSha256']=database_hash; step('database-backed-up')
    failed_step='validate-backups'
    if tree_digest(files)[0]!=record['fileBackupSha256'] or digest(database_backup)!=record['databaseBackupSha256']: raise ValueError('matching backup validation failed')
    step('backups-validated')
    failed_step='provision-config'; copy_protected_config(p['configSourcePath'],posixpath.join(candidate,'wp-config.php'))
    metadata['publicationId']=publication; metadata['publishedAt']=now(); atomic_json(posixpath.join(candidate,META),metadata)
    good,reason=verify_release(candidate,metadata)
    if not good: raise ValueError('candidate changed before switch: '+reason)
    step('config-provisioned')
    previous='previous-'+publication; previous_path=posixpath.join(releases,previous)
    failed_step='move-previous-live'; os.rename(live,previous_path); record['previousRelease']=previous; step('previous-release-moved')
    failed_step='promote-candidate'; os.rename(candidate,live); step('candidate-live')
    if database_input:
      failed_step='import-database'; import_database(p,live,database_input); record['databaseInputSha256']=p['databaseSha256']; os.unlink(database_input); step('database-imported')
    failed_step='clear-caches'; run_wp(p,live,['cache','flush']); run_wp(p,live,['elementor','flush_css'],True); step('caches-cleared')
    failed_step='dependency-check-audit'; run_wp(p,live,['core','verify-checksums']); run_wp(p,live,['plugin','verify-checksums','--all','--strict']); run_wp(p,live,['theme','verify-checksums','--all','--strict']); record['checkAuditResults']={'core':'passed','plugins':'passed','themes':'passed','uploads':'manifest-verified'}; step('dependency-check-audit-passed')
    failed_step='http-smoke-checks'; record['smokeResults']=smoke(p); step('smoke-checks-passed')
    failed_step='disable-maintenance'; maintenance(p,False); step('maintenance-disabled')
    record['status']='completed'; record['completedAt']=now(); step('completed'); return result_record(p,record)
  except BaseException as error:
    if 'previous-release-moved' not in record['completedSteps']:
      try: maintenance(p,False); record['maintenanceRecovered']=True
      except BaseException: pass
    record['status']='failed'; record['failedStep']=failed_step; record['failedAt']=now(); record['failure']='operation failed; inspect server logs'; atomic_json(posixpath.join(publication_dir,RECORD),record)
    return result_record(p,record)
  finally: release_lock(backups)
def result_record(p,record):
  current=None
  try: current=load_json(posixpath.join(p['wordpressPath'],META)).get('release')
  except Exception: pass
  return {'ok':True,'publicationId':record['id'],'release':record['release'],'status':record['status'],'completedSteps':record.get('completedSteps',[]),'failedStep':record.get('failedStep'),'maintenanceActive':os.path.lexists(p['maintenancePath']),'livePath':p['wordpressPath'],'currentRelease':current}
def select_rollback(p):
  _,_,backups=common_publish_preflight(p,True); requested=p.get('publicationId'); rows=publication_rows(backups)
  eligible=[row for row in rows if row['status'] in ('completed','failed') and row.get('rollbackStatus')!='completed']
  if requested: eligible=[row for row in eligible if row['id']==requested]
  if not eligible: raise ValueError('no valid matching publication backup is available')
  selected=sorted(eligible,key=lambda row:(row['createdAt'],row['id']))[-1]; record=load_json(posixpath.join(backups,selected['id'],RECORD))
  publication_dir=posixpath.join(backups,selected['id']); files=posixpath.join(publication_dir,'files'); database=posixpath.join(publication_dir,'database.sql')
  if record.get('fileBackupIdentifier')!=selected['id']+'/files' or record.get('databaseBackupIdentifier')!=selected['id']+'/database.sql': raise ValueError('publication does not identify a matching backup pair')
  if tree_digest(files)[0]!=record.get('fileBackupSha256') or digest(database)!=record.get('databaseBackupSha256'): raise ValueError('matching rollback backup validation failed')
  return {'ok':True,'publicationId':record['id'],'release':record['release'],'fileBackupSha256':record['fileBackupSha256'],'databaseBackupSha256':record['databaseBackupSha256'],'livePath':p['wordpressPath'],'maintenanceActive':os.path.lexists(p['maintenancePath']),'actions':['enable external maintenance','restore matching file snapshot','restore matching database snapshot','clear caches; run checks and smoke tests','disable maintenance and record rollback']}
def rollback(p):
  publication=safe_id(p['publicationId'],r'pub-'); live,releases,backups=validate_base(p,True); publication_dir=posixpath.join(backups,publication)
  if os.path.lexists(publication_dir):
    secure_publication_dir(publication_dir)
    existing=load_json(posixpath.join(publication_dir,RECORD))
    if existing.get('rollbackStatus')=='completed': return result_record(p,existing)
  plan=select_rollback(p); live,releases,backups=validate_base(p,True); publication=plan['publicationId']; publication_dir=posixpath.join(backups,publication); record=load_json(posixpath.join(publication_dir,RECORD)); acquire(backups)
  failed_step='enable-maintenance'
  try:
    maintenance(p,True); record['rollbackStatus']='in-progress'; atomic_json(posixpath.join(publication_dir,RECORD),record)
    failed_step='restore-files-snapshot'
    restored=posixpath.join(releases,'.restoring-'+publication)
    if os.path.lexists(restored):
      if not contained(releases,restored) or os.path.islink(restored) or not os.path.isdir(restored): raise ValueError('stale rollback temporary path is unsafe')
      shutil.rmtree(restored)
    shutil.copytree(posixpath.join(publication_dir,'files'),restored); restored_hash,_=tree_digest(restored)
    if restored_hash!=record['fileBackupSha256']: raise ValueError('restored file snapshot validation failed')
    failed_step='restore-database'
    import_database(p,restored,posixpath.join(publication_dir,'database.sql'))
    failed_step='switch-restored-files'
    live_matches=os.path.isdir(live) and tree_digest(live)[0]==record['fileBackupSha256']
    if live_matches: shutil.rmtree(restored)
    else:
      if os.path.lexists(live): os.rename(live,posixpath.join(releases,'failed-'+publication+'-'+uuid.uuid4().hex[:8]))
      os.rename(restored,live)
    failed_step='checks'
    cache_and_checks(p,live); record['rollbackSmokeResults']=smoke(p)
    failed_step='disable-maintenance'; maintenance(p,False)
    record['status']='rolled-back'; record['rollbackStatus']='completed'; record['rolledBackAt']=now(); atomic_json(posixpath.join(publication_dir,RECORD),record); return result_record(p,record)
  except BaseException:
    record['status']='failed'; record['failedStep']='rollback-'+failed_step; record['rollbackStatus']='failed'; record['rollbackFailedAt']=now(); atomic_json(posixpath.join(publication_dir,RECORD),record); return result_record(p,record)
  finally: release_lock(backups)
def status(p):
  live,releases,backups=validate_base(p,True); current=None
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
  print(json.dumps({'ok':True,'livePath':live,'releasesPath':releases,'currentRelease':current,'maintenanceActive':bool(p.get('maintenancePath') and os.path.lexists(p['maintenancePath'])),'lockActive':bool(backups and os.path.lexists(posixpath.join(backups,LOCK))),'publications':publication_rows(backups) if backups else [],'releases':rows},separators=(',',':')))
try:
  operation=sys.argv[1]
  if operation=='upload': upload()
  else:
    p=json.loads(base64.urlsafe_b64decode(sys.argv[2]+'==='))
    if operation=='preflight': print(json.dumps(preflight(p),separators=(',',':')))
    elif operation=='publish-preflight': print(json.dumps(publish_preflight(p),separators=(',',':')))
    elif operation=='publish': print(json.dumps(publish(p),separators=(',',':')))
    elif operation=='rollback-preflight': print(json.dumps(select_rollback(p),separators=(',',':')))
    elif operation=='rollback': print(json.dumps(rollback(p),separators=(',',':')))
    else: status(p)
except SystemExit: raise
except BaseException as error: fail(str(error))
`;

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function buildDeploySshCommand(
  sshInput: SshWpCliConfig,
  operation:
    | "preflight"
    | "upload"
    | "status"
    | "publish-preflight"
    | "publish"
    | "rollback-preflight"
    | "rollback",
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

function safeRemoteActions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > PUBLISH_STEPS.length)
    throw new DeployError("Remote deploy action plan is invalid.");
  return value.map((action) => safeRemoteText(action, "deploy action", 512));
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
      !Array.isArray(output.publications) ||
      typeof output.maintenanceActive !== "boolean" ||
      typeof output.lockActive !== "boolean" ||
      output.releases.length > MAX_FILES ||
      output.publications.length > MAX_FILES
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
    const publicationStates = new Set([
      "publishing",
      "completed",
      "failed",
      "rolled-back",
    ]);
    const publications = output.publications.map(
      (item): RemotePublicationStatus => {
        if (!item || typeof item !== "object")
          throw new DeployError("Remote status response is invalid.");
        const row = item as Record<string, unknown>;
        const id = safeRemoteText(row.id, "publication identity", 128);
        const release = safeReleaseName(row.release);
        const createdAt = safeRemoteText(
          row.createdAt,
          "publication timestamp",
        );
        if (
          !/^pub-[A-Za-z0-9._-]{1,120}$/.test(id) ||
          typeof row.status !== "string" ||
          !publicationStates.has(row.status) ||
          Number.isNaN(Date.parse(createdAt))
        )
          throw new DeployError("Remote status response is invalid.");
        const failedStep =
          row.failedStep === undefined
            ? undefined
            : safeRemoteText(row.failedStep, "failed step");
        const rollbackStatus =
          row.rollbackStatus === undefined
            ? undefined
            : safeRemoteText(row.rollbackStatus, "rollback status");
        return {
          id,
          release,
          status: row.status as RemotePublicationStatus["status"],
          createdAt,
          ...(failedStep ? { failedStep } : {}),
          ...(rollbackStatus ? { rollbackStatus } : {}),
        };
      },
    );
    return {
      livePath: deploy.wordpressPath,
      releasesPath: deploy.releasesPath,
      currentRelease,
      maintenanceActive: output.maintenanceActive as boolean,
      lockActive: output.lockActive as boolean,
      publications,
      releases,
    };
  }

  async publishPreflight(
    deployInput: DeployConfig,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const deploy = DeployPublishConfigSchema.parse(deployInput);
    const output = parseRemoteResult(
      await this.runner(
        buildDeploySshCommand(this.ssh, "publish-preflight", {
          ...deploy,
          ...payload,
        }),
      ),
    );
    if (
      output.livePath !== deploy.wordpressPath ||
      output.maintenanceActive !== false ||
      output.release !== payload.release ||
      !Number.isSafeInteger(output.requiredBytes) ||
      !Number.isSafeInteger(output.availableBytes)
    )
      throw new DeployError("Remote publish preflight response is invalid.");
    output.actions = safeRemoteActions(output.actions);
    return output;
  }

  async publish(
    deployInput: DeployConfig,
    payload: Record<string, unknown>,
    databasePath?: string,
  ): Promise<PublishResult> {
    const deploy = DeployPublishConfigSchema.parse(deployInput);
    return this.mutationResult(
      await this.runner(
        buildDeploySshCommand(this.ssh, "publish", {
          ...deploy,
          ...payload,
        }),
        databasePath ? createReadStream(databasePath) : undefined,
      ),
      deploy,
    );
  }

  async rollbackPreflight(
    deployInput: DeployConfig,
    publicationId?: string,
  ): Promise<Record<string, unknown>> {
    const deploy = DeployPublishConfigSchema.parse(deployInput);
    const output = parseRemoteResult(
      await this.runner(
        buildDeploySshCommand(this.ssh, "rollback-preflight", {
          ...deploy,
          ...(publicationId ? { publicationId } : {}),
        }),
      ),
    );
    if (
      output.livePath !== deploy.wordpressPath ||
      typeof output.maintenanceActive !== "boolean" ||
      !/^pub-[A-Za-z0-9._-]{1,120}$/.test(
        safeRemoteText(output.publicationId, "publication identity", 128),
      )
    )
      throw new DeployError("Remote rollback preflight response is invalid.");
    for (const digest of [output.fileBackupSha256, output.databaseBackupSha256])
      if (!/^[a-f0-9]{64}$/.test(safeRemoteText(digest, "backup digest", 64)))
        throw new DeployError("Remote rollback preflight response is invalid.");
    output.actions = safeRemoteActions(output.actions);
    return output;
  }

  async rollback(
    deployInput: DeployConfig,
    publicationId: string,
  ): Promise<PublishResult> {
    const deploy = DeployPublishConfigSchema.parse(deployInput);
    return this.mutationResult(
      await this.runner(
        buildDeploySshCommand(this.ssh, "rollback", {
          ...deploy,
          publicationId,
        }),
      ),
      deploy,
    );
  }

  private mutationResult(
    result: CommandResult,
    deploy: DeployConfig,
  ): PublishResult {
    const output = parseRemoteResult(result);
    const publicationId = safeRemoteText(
      output.publicationId,
      "publication identity",
      128,
    );
    const release = safeReleaseName(output.release);
    if (
      !/^pub-[A-Za-z0-9._-]{1,120}$/.test(publicationId) ||
      !["completed", "failed", "rolled-back"].includes(String(output.status)) ||
      !Array.isArray(output.completedSteps) ||
      output.completedSteps.length > PUBLISH_STEPS.length ||
      typeof output.maintenanceActive !== "boolean" ||
      output.livePath !== deploy.wordpressPath
    )
      throw new DeployError("Remote deploy mutation response is invalid.");
    const completedSteps = output.completedSteps.map((step) =>
      safeRemoteText(step, "completed step", 128),
    );
    const databaseRequested = completedSteps.includes("database-imported");
    const expectedSteps = PUBLISH_STEPS.filter(
      (step) => databaseRequested || step !== "database-imported",
    );
    if (
      completedSteps.some((step, index) => step !== expectedSteps[index]) ||
      (output.status === "completed" &&
        completedSteps.length !== expectedSteps.length)
    )
      throw new DeployError("Remote publication state evidence is invalid.");
    const currentRelease =
      output.currentRelease === null
        ? null
        : safeReleaseName(output.currentRelease, "current release");
    const failedStep =
      output.failedStep === undefined || output.failedStep === null
        ? undefined
        : safeRemoteText(output.failedStep, "failed step", 128);
    return {
      publicationId,
      release,
      status: output.status as PublishResult["status"],
      completedSteps,
      maintenanceActive: output.maintenanceActive,
      livePath: deploy.wordpressPath,
      currentRelease,
      ...(failedStep ? { failedStep } : {}),
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

export async function inspectSanitizedDatabase(path: string): Promise<{
  path: string;
  size: number;
  sha256: string;
}> {
  const configured = resolve(path);
  if (!/\.sql$/i.test(configured))
    throw new DeployError(
      "Sanitized database input must be an uncompressed .sql file.",
    );
  try {
    const stats = await lstat(configured);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.size < 1 ||
      stats.size > MAX_BYTES ||
      (await realpath(configured)) !== configured
    )
      throw new Error();
    const inspected = await inspectFile(configured);
    return { path: configured, size: inspected.size, sha256: inspected.sha256 };
  } catch {
    throw new DeployError(
      "Sanitized database input must be a canonical, non-symlink regular file within size limits.",
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
