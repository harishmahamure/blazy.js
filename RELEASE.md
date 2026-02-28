# Release & Deployment Guide

## 🚀 Quick Commands

### Initial Setup (One Time)

```bash
# 1. Login to npm
npm login

# 2. Set npm token (if using automation)
npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN_HERE

# 3. Clean git history (fresh start)
cd /Users/harishmahamure/light-weight-backend
rm -rf .git
git init
git add .
git commit -m "Initial release: Blazy.JS v1.0.0"
git remote add origin https://github.com/harishmahamure/blazy.js.git
git push -u origin master --force
```

---

## 📦 Publishing New Versions

### Patch Release (1.0.0 → 1.0.1)
**Use for:** Bug fixes, typos, small corrections

```bash
npm run release:patch
```

**What it does:**
1. Bumps version: `1.0.0` → `1.0.1`
2. Creates git commit: `Release v1.0.1`
3. Creates git tag: `v1.0.1`
4. Builds TypeScript (`dist/`)
5. Publishes to npm
6. Pushes commit + tags to GitHub

---

### Minor Release (1.0.0 → 1.1.0)
**Use for:** New features, non-breaking changes

```bash
npm run release:minor
```

**What it does:**
1. Bumps version: `1.0.0` → `1.1.0`
2. Creates git commit: `Release v1.1.0`
3. Creates git tag: `v1.1.0`
4. Builds TypeScript
5. Publishes to npm
6. Pushes to GitHub

---

### Major Release (1.0.0 → 2.0.0)
**Use for:** Breaking changes, major rewrites

```bash
npm run release:major
```

**What it does:**
1. Bumps version: `1.0.0` → `2.0.0`
2. Creates git commit: `Release v2.0.0`
3. Creates git tag: `v2.0.0`
4. Builds TypeScript
5. Publishes to npm
6. Pushes to GitHub

---

## 🔄 Workflow

```bash
# Make changes
vim src/core/app.ts

# Test locally
npm run dev

# Build & verify
npm run build
npm start

# Release (choose one)
npm run release:patch   # Bug fixes
npm run release:minor   # New features
npm run release:major   # Breaking changes
```

---

## 🎯 Version Numbering

**Semantic Versioning (SemVer): MAJOR.MINOR.PATCH**

| Type | When to Use | Example | Command |
|------|-------------|---------|---------|
| **PATCH** | Bug fixes, docs, typos | 1.0.0 → 1.0.1 | `npm run release:patch` |
| **MINOR** | New features (backward compatible) | 1.0.0 → 1.1.0 | `npm run release:minor` |
| **MAJOR** | Breaking changes | 1.0.0 → 2.0.0 | `npm run release:major` |

---

## 🏷️ Git Tags

All releases are automatically tagged:

```bash
# View all tags
git tag

# View tag details
git show v1.0.1

# Delete a tag (if needed)
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
```

---

## 🔍 Verify Release

### Check npm
```bash
npm info @harishmahamure/blazy.js
npm view @harishmahamure/blazy.js versions
```

### Check GitHub
```bash
git log --oneline
git tag
```

### Test Installation
```bash
cd /tmp
mkdir test-blazy && cd test-blazy
npm init -y
npm install @harishmahamure/blazy.js
node -e "const blazy = require('@harishmahamure/blazy.js'); console.log(Object.keys(blazy));"
```

---

## 🔧 Manual Version Bump (if needed)

```bash
# Bump version manually
npm version patch   # or minor, or major

# Build
npm run build

# Publish
npm publish --access public

# Push git changes
git push && git push --tags
```

---

## 🛑 Rollback (Unpublish)

**⚠️ Only use within 72 hours of publishing!**

```bash
# Unpublish specific version
npm unpublish @harishmahamure/blazy.js@1.0.1

# Deprecate instead (recommended)
npm deprecate @harishmahamure/blazy.js@1.0.1 "Please upgrade to 1.0.2"
```

---

## 📊 npm Package Stats

```bash
# View package info
npm info @harishmahamure/blazy.js

# View download stats (after published)
npm view @harishmahamure/blazy.js

# Search for package
npm search blazy
```

---

## 🎉 Release Checklist

- [ ] All tests pass
- [ ] TypeScript compiles (`npm run build`)
- [ ] README updated
- [ ] CHANGELOG updated (if you maintain one)
- [ ] Version bumped correctly
- [ ] Git committed and pushed
- [ ] npm published
- [ ] GitHub release created (optional)
- [ ] Announcement made (optional)

---

## 🔗 Links

- **npm package:** https://www.npmjs.com/package/@harishmahamure/blazy.js
- **GitHub repo:** https://github.com/harishmahamure/blazy.js
- **npm profile:** https://www.npmjs.com/~harishmahamure
