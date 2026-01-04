#!/bin/bash

# Monad Release Script
# Automates the complete release process with pre-checks and version management

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
PACKAGES=("packages/vite-plugin-monad" "packages/create-monad")
DRY_RUN=false
PATCH_VERSION=true
SKIP_CHECKS=false

# Help function
show_help() {
    echo "Monad Release Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -d, --dry-run       Run without actually publishing (default: false)"
    echo "  -m, --minor         Bump minor version instead of patch (default: patch)"
    echo "  -M, --major         Bump major version instead of patch (default: patch)"
    echo "  -s, --skip-checks   Skip pre-release checks (default: false)"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                  # Patch release (0.1.0 -> 0.1.1)"
    echo "  $0 -m               # Minor release (0.1.9 -> 0.2.0)"
    echo "  $0 -M               # Major release (0.2.9 -> 1.0.0)"
    echo "  $0 -d               # Dry run - show what would happen"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -m|--minor)
            PATCH_VERSION=false
            BUMP_TYPE="minor"
            shift
            ;;
        -M|--major)
            PATCH_VERSION=false
            BUMP_TYPE="major"
            shift
            ;;
        -s|--skip-checks)
            SKIP_CHECKS=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Set default bump type if not specified
if [[ "$PATCH_VERSION" == "true" ]]; then
    BUMP_TYPE="patch"
fi

# Utility functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_step() {
    echo -e "\n${BLUE}==>${NC} $1"
}

# Check if we're in the right directory
check_directory() {
    if [[ ! -f "package.json" ]] || [[ ! -d ".changeset" ]]; then
        log_error "Must be run from the monorepo root directory"
        exit 1
    fi

    if ! grep -q "@wynterai/monad" package.json; then
        log_error "Not in the correct monad repository"
        exit 1
    fi

    log_success "Running from correct directory"
}

# Check git status
check_git_status() {
    if [[ "$SKIP_CHECKS" == "true" ]]; then
        log_warning "Skipping git status check"
        return
    fi

    # Check if we have uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        log_error "You have uncommitted changes. Please commit or stash them first."
        git status --short
        exit 1
    fi

    # Check if we're on main branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$CURRENT_BRANCH" != "main" ]]; then
        log_warning "You're not on the main branch (current: $CURRENT_BRANCH)"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Release cancelled"
            exit 0
        fi
    fi

    log_success "Git status is clean"
}

# Check if we're logged into npm
check_npm_auth() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run: Skipping npm auth check"
        return
    fi

    if ! npm whoami > /dev/null 2>&1; then
        log_error "You're not logged into npm. Please run 'npm login' first."
        exit 1
    fi

    NPM_USER=$(npm whoami)
    log_success "Logged into npm as: $NPM_USER"
}

# Check dependencies and install if needed
check_dependencies() {
    if [[ ! -d "node_modules" ]] || [[ ! -f "package-lock.json" ]]; then
        log_step "Installing dependencies"
        npm install
        log_success "Dependencies installed"
    else
        log_success "Dependencies are installed"
    fi
}

# Run tests and linting
run_tests() {
    if [[ "$SKIP_CHECKS" == "true" ]]; then
        log_warning "Skipping tests and linting"
        return
    fi

    log_step "Running tests and checks"

    # Check if TypeScript compiles
    log_info "Checking TypeScript compilation..."
    if ! npm run build > /dev/null 2>&1; then
        log_error "TypeScript compilation failed"
        npm run build
        exit 1
    fi
    log_success "TypeScript compilation passed"

    # Test the example site builds
    log_info "Testing example site build..."
    if ! npm run preview > /dev/null 2>&1; then
        log_error "Example site build failed"
        exit 1
    fi
    log_success "Example site builds successfully"
}

# Show current package versions
show_current_versions() {
    log_step "Current package versions"
    for package in "${PACKAGES[@]}"; do
        if [[ -f "$package/package.json" ]]; then
            VERSION=$(grep '"version"' "$package/package.json" | sed 's/.*"version": "\(.*\)".*/\1/')
            PACKAGE_NAME=$(grep '"name"' "$package/package.json" | sed 's/.*"name": "\(.*\)".*/\1/')
            log_info "$PACKAGE_NAME: $VERSION"
        fi
    done
}

# Create changeset for patch version
create_patch_changeset() {
    log_step "Creating changeset for $BUMP_TYPE release"

    # Create changeset content
    CHANGESET_ID=$(date +%s)
    CHANGESET_FILE=".changeset/release-${CHANGESET_ID}.md"

    cat > "$CHANGESET_FILE" << EOF
---
"@wynterai/vite-plugin-monad": $BUMP_TYPE
"@wynterai/create-monad": $BUMP_TYPE
---

Automated $BUMP_TYPE release
EOF

    log_success "Created changeset: $CHANGESET_FILE"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run: Changeset content:"
        cat "$CHANGESET_FILE"
    fi
}

# Version packages using changeset
version_packages() {
    log_step "Versioning packages"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run: Would run 'npx changeset version'"
        log_info "This would update package.json files and create CHANGELOG.md files"
    else
        npx changeset version
        log_success "Packages versioned"

        # Update the example package dependency
        update_example_dependency
    fi
}

# Update example dependency to use new version
update_example_dependency() {
    log_info "Updating example dependency version..."

    # Get new version of vite-plugin-monad
    NEW_VERSION=$(grep '"version"' packages/vite-plugin-monad/package.json | sed 's/.*"version": "\(.*\)".*/\1/')

    # Update example package.json
    sed -i '' "s/\"@wynterai\/vite-plugin-monad\": \".*\"/\"@wynterai\/vite-plugin-monad\": \"$NEW_VERSION\"/" examples/marketing-site/package.json

    log_success "Updated example to use version $NEW_VERSION"
}

# Show what will be published
show_publish_plan() {
    log_step "Publish plan"
    for package in "${PACKAGES[@]}"; do
        if [[ -f "$package/package.json" ]]; then
            VERSION=$(grep '"version"' "$package/package.json" | sed 's/.*"version": "\(.*\)".*/\1/')
            PACKAGE_NAME=$(grep '"name"' "$package/package.json" | sed 's/.*"name": "\(.*\)".*/\1/')

            if [[ "$DRY_RUN" == "true" ]]; then
                log_info "Would publish: $PACKAGE_NAME@$VERSION"
            else
                log_info "Will publish: $PACKAGE_NAME@$VERSION"
            fi
        fi
    done
}

# Build packages
build_packages() {
    log_step "Building packages"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run: Would run 'npm run build'"
    else
        npm run build
        log_success "All packages built successfully"
    fi
}

# Publish packages in order
publish_packages() {
    log_step "Publishing packages"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run: Would publish packages in this order:"
        for package in "${PACKAGES[@]}"; do
            PACKAGE_NAME=$(grep '"name"' "$package/package.json" | sed 's/.*"name": "\(.*\)".*/\1/')
            log_info "  - $PACKAGE_NAME"
        done
        return
    fi

    # Publish each package in order
    for package in "${PACKAGES[@]}"; do
        if [[ -f "$package/package.json" ]]; then
            PACKAGE_NAME=$(grep '"name"' "$package/package.json" | sed 's/.*"name": "\(.*\)".*/\1/')
            VERSION=$(grep '"version"' "$package/package.json" | sed 's/.*"version": "\(.*\)".*/\1/')

            log_info "Publishing $PACKAGE_NAME@$VERSION..."

            if npm publish --workspace="$package" --access=public; then
                log_success "Published $PACKAGE_NAME@$VERSION"
            else
                log_error "Failed to publish $PACKAGE_NAME"
                exit 1
            fi
        fi
    done
}

# Commit and tag the release
commit_and_tag() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run: Would commit changes and create git tags"
        return
    fi

    log_step "Committing release changes"

    # Add all changed files
    git add .

    # Create commit message
    COMMIT_MSG="Release: Bump versions ($BUMP_TYPE)"

    git commit -m "$COMMIT_MSG"
    log_success "Committed release changes"

    # Create tags for each package
    for package in "${PACKAGES[@]}"; do
        if [[ -f "$package/package.json" ]]; then
            VERSION=$(grep '"version"' "$package/package.json" | sed 's/.*"version": "\(.*\)".*/\1/')
            PACKAGE_NAME=$(grep '"name"' "$package/package.json" | sed 's/.*"name": "\(.*\)".*/\1/' | sed 's/@wynterai\///')

            TAG_NAME="${PACKAGE_NAME}@${VERSION}"
            git tag "$TAG_NAME"
            log_success "Created tag: $TAG_NAME"
        fi
    done
}

# Push changes and tags
push_changes() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run: Would push commits and tags to remote"
        return
    fi

    log_step "Pushing changes to remote"

    git push origin main
    git push origin --tags

    log_success "Pushed changes and tags to remote"
}

# Cleanup temporary files
cleanup() {
    log_step "Cleaning up"

    # Remove changeset files (they're consumed by changeset version)
    if [[ "$DRY_RUN" != "true" ]]; then
        find .changeset -name "release-*.md" -delete 2>/dev/null || true
    fi

    log_success "Cleanup completed"
}

# Show summary
show_summary() {
    log_step "Release Summary"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN COMPLETED - No actual changes were made"
        log_info "To perform the actual release, run: $0 $(echo "$@" | sed 's/-d\|--dry-run//g')"
    else
        log_success "🎉 Release completed successfully!"

        log_info "Published packages:"
        for package in "${PACKAGES[@]}"; do
            if [[ -f "$package/package.json" ]]; then
                VERSION=$(grep '"version"' "$package/package.json" | sed 's/.*"version": "\(.*\)".*/\1/')
                PACKAGE_NAME=$(grep '"name"' "$package/package.json" | sed 's/.*"name": "\(.*\)".*/\1/')
                log_info "  ✓ $PACKAGE_NAME@$VERSION"
            fi
        done

        echo ""
        log_info "Next steps:"
        log_info "  • Check npm: https://www.npmjs.com/package/@wynterai/vite-plugin-monad"
        log_info "  • Check npm: https://www.npmjs.com/package/@wynterai/create-monad"
        log_info "  • Update documentation if needed"
        log_info "  • Announce the release!"
    fi
}

# Error handling
handle_error() {
    local exit_code=$?
    log_error "Release failed with exit code $exit_code"
    log_info "Please check the error above and try again"
    cleanup
    exit $exit_code
}

# Set up error handling
trap handle_error ERR

# Main execution
main() {
    echo -e "${BLUE}"
    echo "🚀 Monad Release Script"
    echo "======================"
    echo -e "${NC}"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN MODE - No changes will be made"
    fi

    log_info "Release type: $BUMP_TYPE"
    echo ""

    # Pre-checks
    check_directory
    check_git_status
    check_npm_auth
    check_dependencies
    show_current_versions
    run_tests

    # Confirm before proceeding
    if [[ "$DRY_RUN" != "true" ]]; then
        echo ""
        read -p "Proceed with $BUMP_TYPE release? (y/N): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Release cancelled"
            exit 0
        fi
    fi

    # Release process
    create_patch_changeset
    version_packages
    show_publish_plan
    build_packages
    publish_packages
    commit_and_tag
    push_changes
    cleanup
    show_summary
}

# Run main function
main "$@"