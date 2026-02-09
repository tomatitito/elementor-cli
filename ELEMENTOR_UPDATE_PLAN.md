# Elementor CLI Update & Compatibility Plan

## Overview
This document outlines the necessary steps to ensure the Elementor CLI remains compatible with updates to the Elementor core project. The CLI currently has moderate to high coupling with Elementor's internal data structures and needs improvements for better version compatibility.

### Testing Strategy
- **Actively test**: Current Elementor version + Previous 2 versions (3 versions total)
- **Detection method**: GitHub Actions checking daily for new releases
- **Response time**: Automated tests run immediately upon detection

## Current Situation Assessment

### Risk Areas
- **Critical**: Meta field names (`_elementor_data`, `_elementor_page_settings`, etc.)
- **High**: Element types and widget structure assumptions
- **Medium**: Widget settings, CSS metadata format, REST API endpoints

### Key Dependencies
1. WordPress REST API endpoints
2. Elementor meta field structure
3. Element tree JSON format
4. Widget naming conventions
5. Page settings storage format

## Phase 1: Immediate Actions (Priority: HIGH)

### 1.1 Test Current Compatibility
**Timeline**: Immediately
**Owner**: Development Team

- [ ] Set up test WordPress site with latest Elementor version
- [ ] Run full test suite of CLI commands:
  ```bash
  elementor pull --all
  elementor push --dry-run --all
  elementor search-replace "test" "test2" --dry-run
  elementor audit
  elementor templates list
  ```
- [ ] Document any errors or unexpected behavior
- [ ] Create issue tickets for each identified incompatibility

### 1.2 Review Elementor Changelog
**Timeline**: Within 1 day
**Owner**: Development Team

- [ ] Check [Elementor GitHub Releases](https://github.com/elementor/elementor/releases)
- [ ] Review breaking changes in recent versions
- [ ] Identify deprecated features we depend on
- [ ] Document findings in `docs/elementor-compatibility.md`

## Phase 2: Version Detection & Validation (Priority: HIGH)

### 2.1 Implement Elementor Version Detection
**Timeline**: Week 1
**Files to modify**: 
- `src/services/wordpress-client.ts`
- `src/commands/connect.ts`

**Tasks**:
- [ ] Add method to detect Elementor version via REST API or plugin list
- [ ] Store Elementor version in connection metadata
- [ ] Display version during `elementor connect` command
- [ ] Add version info to `elementor status` command output

**Implementation sketch**:
```typescript
// In wordpress-client.ts
async getElementorVersion(): Promise<string | null> {
  try {
    const plugins = await this.request('/wp/v2/plugins');
    const elementor = plugins.find(p => p.slug === 'elementor');
    return elementor?.version || null;
  } catch {
    return null;
  }
}
```

### 2.2 Create Compatibility Matrix
**Timeline**: Week 1
**Files to create/modify**:
- `src/config/compatibility.ts` (new)
- `README.md`

**Tasks**:
- [ ] Define minimum supported Elementor version
- [ ] Define maximum tested Elementor version
- [ ] Create compatibility checking function
- [ ] Add warnings for untested versions
- [ ] Update README with compatibility table

**Compatibility Table Format**:
```markdown
| CLI Version | Elementor Version | Status |
|-------------|------------------|--------|
| 0.3.x       | Current (3.20.x) | ✅ Actively Tested |
| 0.3.x       | Previous-1 (3.19.x)| ✅ Actively Tested |
| 0.3.x       | Previous-2 (3.18.x)| ✅ Actively Tested |
| 0.3.x       | Older (< 3.18.x) | ⚠️ Best Effort |
```

## Phase 3: Schema Validation & Type Safety (Priority: MEDIUM)

### 3.1 Create Widget Schema System
**Timeline**: Week 2
**Files to create/modify**:
- `src/schemas/widgets/` (new directory)
- `src/types/widget-schemas.ts` (new)
- `src/services/schema-validator.ts` (new)

**Tasks**:
- [ ] Define schema format using Zod
- [ ] Create schemas for common widgets:
  - [ ] heading
  - [ ] text-editor
  - [ ] image
  - [ ] button
  - [ ] video
  - [ ] spacer
  - [ ] divider
  - [ ] icon
- [ ] Implement validation in parser
- [ ] Add `--strict` flag to enable schema validation
- [ ] Create schema documentation

### 3.2 Implement Element Type Registry
**Timeline**: Week 2
**Files to modify**:
- `src/types/elementor.ts`
- `src/services/element-registry.ts` (new)

**Tasks**:
- [ ] Create extensible element type system
- [ ] Support custom element types
- [ ] Add unknown element type handling
- [ ] Implement element type discovery from WordPress

## Phase 4: Defensive Programming (Priority: MEDIUM)

### 4.1 Add Graceful Degradation
**Timeline**: Week 3
**Files to modify**: Multiple parser and service files

**Tasks**:
- [ ] Add try-catch blocks around element parsing
- [ ] Implement fallback for unknown widget types
- [ ] Add warning system for unsupported features
- [ ] Create `--ignore-errors` flag for forced operations
- [ ] Implement partial success reporting

### 4.2 Improve Error Messages
**Timeline**: Week 3

**Tasks**:
- [ ] Add specific error codes for compatibility issues
- [ ] Include Elementor version in error messages
- [ ] Provide actionable fix suggestions
- [ ] Add `--verbose` flag for detailed error output

## Phase 5: Testing Infrastructure (Priority: HIGH)

### 5.1 Create Integration Test Suite
**Timeline**: Week 3-4
**Files to create**:
- `tests/integration/` (new directory)
- `.github/workflows/integration-tests.yml` (new)

**Tasks**:
- [ ] Set up Docker containers with **current and previous 2** Elementor versions
- [ ] Create test WordPress instances (3 environments: current + previous-1 + previous-2)
- [ ] Write integration tests for core functionality:
  - [ ] Pull/push operations
  - [ ] Search and replace
  - [ ] Template operations
  - [ ] URL rewriting
- [ ] Add to CI/CD pipeline
- [ ] Run tests when new Elementor version is detected

### 5.2 Automated Release Detection
**Timeline**: Week 4
**Method**: GitHub Actions only

**Tasks**:
- [ ] Create `.github/workflows/elementor-release-monitor.yml` 
- [ ] Create `.github/workflows/elementor-compatibility-tests.yml`
- [ ] Set up daily schedule (9 AM UTC)
- [ ] Configure automatic test triggering
- [ ] Set up GitHub issue creation for tracking
- [ ] Test workflow with manual trigger

## Phase 6: Feature Detection System (Priority: LOW)

### 6.1 Implement Capability Detection
**Timeline**: Week 5
**Files to create**:
- `src/services/capability-detector.ts` (new)

**Tasks**:
- [ ] Detect available element types
- [ ] Detect available widgets
- [ ] Check for custom meta fields
- [ ] Verify REST API endpoints
- [ ] Cache capabilities per connection

### 6.2 Add Feature Flags
**Timeline**: Week 5

**Tasks**:
- [ ] Create feature flag system
- [ ] Allow disabling incompatible features
- [ ] Add config option for feature overrides
- [ ] Document feature flags in help text

## Phase 7: Documentation & Communication (Priority: MEDIUM)

### 7.1 Create Compatibility Documentation
**Timeline**: Week 6
**Files to create/modify**:
- `docs/compatibility-guide.md` (new)
- `docs/troubleshooting.md` (update)
- `CHANGELOG.md` (update)

**Tasks**:
- [ ] Write comprehensive compatibility guide
- [ ] Document known issues and workarounds
- [ ] Create migration guides for breaking changes
- [ ] Add FAQ section for common problems

### 7.2 Implement Update Notifications
**Timeline**: Week 6

**Tasks**:
- [ ] Add version check on CLI startup
- [ ] Show warnings for outdated CLI versions
- [ ] Add `elementor check-updates` command
- [ ] Create notification for Elementor compatibility issues

## Phase 8: Automated Elementor Release Detection (Priority: HIGH)

### 8.1 Complete GitHub Actions Implementation
**Timeline**: Week 1
**Schedule**: Daily at 9 AM UTC
**Method**: GitHub Actions only (no other detection methods needed)

#### Primary Detection Workflow
**File**: `.github/workflows/elementor-release-monitor.yml`
```yaml
name: Monitor Elementor Releases
on:
  schedule:
    # Run once daily at 9 AM UTC
    - cron: '0 9 * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  check-elementor-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Check for new Elementor release
        id: check
        run: |
          # Get latest release from Elementor GitHub
          LATEST_RELEASE=$(curl -s https://api.github.com/repos/elementor/elementor/releases/latest | jq -r '.tag_name')
          
          # Get our last known version
          LAST_KNOWN=$(cat .github/last-known-elementor-version.txt 2>/dev/null || echo "")
          
          echo "Latest Elementor version: $LATEST_RELEASE"
          echo "Last known version: $LAST_KNOWN"
          
          if [ "$LATEST_RELEASE" != "$LAST_KNOWN" ]; then
            echo "🎉 New release detected!"
            echo "new_release=true" >> $GITHUB_OUTPUT
            echo "version=$LATEST_RELEASE" >> $GITHUB_OUTPUT
          else
            echo "No new release"
            echo "new_release=false" >> $GITHUB_OUTPUT
          fi
      
      - name: Update known version
        if: steps.check.outputs.new_release == 'true'
        run: |
          echo "${{ steps.check.outputs.version }}" > .github/last-known-elementor-version.txt
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add .github/last-known-elementor-version.txt
          git commit -m "Update last known Elementor version to ${{ steps.check.outputs.version }}"
          git push
      
      - name: Trigger compatibility tests
        if: steps.check.outputs.new_release == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const version = '${{ steps.check.outputs.version }}';
            
            // Create issue for tracking
            const issue = await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `🔄 Test compatibility with Elementor ${version}`,
              body: `## New Elementor Version Released: ${version}
              
              A new version of Elementor has been detected. Automated compatibility tests are now running.
              
              ### Automated Test Checklist
              - [ ] Test environment setup with Elementor ${version}
              - [ ] Pull operations test
              - [ ] Push operations test
              - [ ] Search & replace test
              - [ ] Template operations test
              - [ ] URL rewriting test
              
              ### Manual Review Required
              - [ ] Review test results
              - [ ] Check for breaking changes in [Elementor changelog](https://github.com/elementor/elementor/releases/tag/${version})
              - [ ] Update compatibility matrix if tests pass
              - [ ] Create patch release if fixes needed
              
              Test results will be posted here when complete.`,
              labels: ['elementor-update', 'testing', 'automated']
            });
            
            // Trigger the test workflow
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: 'elementor-compatibility-tests.yml',
              ref: 'main',
              inputs: {
                elementor_version: version,
                issue_number: issue.data.number.toString()
              }
            });
            
            console.log(`Created issue #${issue.data.number} and triggered tests for Elementor ${version}`);
```

#### Compatibility Test Workflow
**File**: `.github/workflows/elementor-compatibility-tests.yml`
```yaml
name: Elementor Compatibility Tests
on:
  workflow_dispatch:
    inputs:
      elementor_version:
        description: 'Elementor version to test'
        required: true
      issue_number:
        description: 'Issue number for posting results'
        required: false

jobs:
  test-compatibility:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        test-version: ['current', 'previous-1', 'previous-2']
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install CLI dependencies
        run: npm ci
      
      - name: Set up test environment
        run: |
          # Determine which version to test
          if [ "${{ matrix.test-version }}" = "current" ]; then
            ELEMENTOR_VERSION="${{ github.event.inputs.elementor_version }}"
          elif [ "${{ matrix.test-version }}" = "previous-1" ]; then
            # Get the previous version (you'll need to implement this logic)
            ELEMENTOR_VERSION=$(node scripts/get-previous-elementor-version.js --offset 1)
          else
            # Get the version before previous
            ELEMENTOR_VERSION=$(node scripts/get-previous-elementor-version.js --offset 2)
          fi
          
          echo "Testing with Elementor $ELEMENTOR_VERSION"
          
          # Set up WordPress with specific Elementor version
          docker-compose -f tests/docker-compose.yml up -d
          docker exec wordpress wp plugin install elementor --version=$ELEMENTOR_VERSION --activate
      
      - name: Run compatibility tests
        run: |
          npm run test:integration
      
      - name: Post results to issue
        if: github.event.inputs.issue_number
        uses: actions/github-script@v7
        with:
          script: |
            const status = '${{ job.status }}';
            const version = '${{ matrix.test-version }}';
            const emoji = status === 'success' ? '✅' : '❌';
            
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: ${{ github.event.inputs.issue_number }},
              body: `${emoji} Compatibility test for **${version}** version: ${status}`
            });
```

### 8.2 How It Works - Automated Flow

When a new Elementor version is released:

1. **Detection (within 24 hours)**
   - GitHub Action runs daily check
   - Compares with last known version
   - Detects new release

2. **Automatic Actions**
   - Creates GitHub issue with test checklist
   - Triggers compatibility test workflow
   - Tests current and previous 2 versions (3 total)
   - Posts results to issue

3. **Manual Review**
   - Team reviews test results in GitHub issue
   - Checks Elementor changelog for breaking changes
   - Updates compatibility matrix if tests pass
   - Creates patch release if fixes needed

### 8.3 Version Management Strategy
**Timeline**: Ongoing

**Testing Policy**:
- **Current Version**: Full test suite, all features
- **Previous-1 Version**: Full test suite, all features
- **Previous-2 Version**: Core functionality tests only
- **Older Versions**: No active testing (best effort support)

**Version Tracking File**: `.github/elementor-versions.json`
```json
{
  "current": "3.20.0",
  "previous_1": "3.19.0",
  "previous_2": "3.18.0",
  "last_checked": "2026-02-09",
  "test_status": {
    "3.20.0": "passing",
    "3.19.0": "passing",
    "3.18.0": "passing"
  }
}
```

## Implementation Priority Order

### Immediate (Day 1-2)
1. **Phase 8**: Set up GitHub Actions for automated detection
2. **Phase 1.1**: Test current compatibility manually

### Week 1
3. **Phase 2**: Implement version detection in CLI
4. **Phase 5**: Set up test infrastructure for current + previous 2 versions

### Week 2-3
5. **Phase 4**: Add defensive programming
6. **Phase 3**: Create widget schema validation

### Week 4+
7. **Phase 6**: Feature detection (optional)
8. **Phase 7**: Documentation updates

## Success Metrics

- [ ] Zero critical failures with current Elementor version
- [ ] Zero critical failures with previous-1 Elementor version
- [ ] Zero critical failures with previous-2 Elementor version
- [ ] < 5% of operations fail due to compatibility
- [ ] 100% of common widgets have schema validation
- [ ] Automated detection of new Elementor releases within 24 hours
- [ ] Automated test execution immediately upon detection
- [ ] Clear documentation for all compatibility issues
- [ ] < 48 hour response time to fix breaking changes

## Risk Mitigation

### High-Risk Changes to Monitor
1. Meta field restructuring
2. REST API endpoint changes
3. Element hierarchy modifications
4. Widget deprecation/renaming
5. Settings format changes

### Contingency Plans
- Maintain compatibility branches for major Elementor versions
- Provide version-specific CLI releases if needed
- Create adapter layer for version differences
- Offer migration tools for breaking changes

## Resources Required

- Access to Elementor Pro for testing
- Multiple WordPress test environments
- CI/CD infrastructure for automated testing
- Developer time: ~6 weeks for full implementation
- Ongoing maintenance: ~2 hours/week

## Quick Start: Immediate Implementation

### Step 1: Set Up GitHub Actions (Day 1)
1. Create `.github/workflows/` directory if it doesn't exist
2. Copy the `elementor-release-monitor.yml` workflow from Phase 8.1
3. Copy the `elementor-compatibility-tests.yml` workflow from Phase 8.1
4. Create `.github/last-known-elementor-version.txt` with current version (e.g., "3.20.0")
5. Commit and push to enable the workflows

### Step 2: Create Test Infrastructure (Day 2)
1. Set up Docker Compose configuration for test environments:
   ```yaml
   # tests/docker-compose.yml
   version: '3'
   services:
     wordpress:
       image: wordpress:latest
       environment:
         WORDPRESS_DB_HOST: db
         WORDPRESS_DB_PASSWORD: example
     db:
       image: mysql:5.7
       environment:
         MYSQL_ROOT_PASSWORD: example
   ```

2. Create integration test script:
   ```bash
   # tests/run-integration-tests.sh
   npm run build
   elementor connect http://localhost:8080
   elementor pull --all
   elementor push --dry-run --all
   elementor search-replace "test" "test2" --dry-run
   ```

### Step 3: Manual Test Today
Run this command to manually check for new versions and test:
```bash
# Check current Elementor version
curl -s https://api.github.com/repos/elementor/elementor/releases/latest | jq -r '.tag_name'

# Run your tests against a site with that version
npm test
```

## Next Steps

1. Review and approve this plan
2. Implement Quick Start Step 1 immediately
3. Set up GitHub Action (Step 2) within 2 days
4. Create test environments for current + previous 2 versions
5. Begin systematic implementation of other phases

---

*Document created: February 9, 2026*
*Last updated: February 9, 2026*
*Version: 2.1 - Updated to support current + previous 2 versions (3 versions total)*