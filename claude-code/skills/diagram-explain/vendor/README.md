# vendor

- `elk.bundled.js`: `lib/elk.bundled.js` from elkjs 0.12.1 (https://registry.npmjs.org/elkjs/-/elkjs-0.12.1.tgz, integrity `sha512-IhMYKHE4S2vtx0QrhBP3lYOIKDeIiJXBrdq9MGYkuB8ZHqhrBnHNfSUndjXFewrX1CPK8chwq+2NA0K0hliYuw==`), unmodified. License: EPL-2.0 OR GPL-3.0-or-later, see `LICENSE.md` (copied from the same tarball). Source: https://github.com/kieler/elkjs
- Blob pins (`git hash-object <file>`), checked by `layout.test.ts`:
  - `elk.bundled.js`: `fbebd45cfd9cd1fe10c5e5165e3ba16653e129bd`
  - `LICENSE.md`: `91dd37eefbe62d3d9fb7a1e7e2c7a9a1e2cdcbcc`
- Vendored rather than installed, so `nix-darwin/diagram-render.nix` builds with no npm fetch. Renewal: when bumping, read the upstream release notes, download the tarball, check it against the registry's `dist.integrity`, copy both files unmodified (the user does this; the sandbox blocks Bash writes under `claude-code/`), run `bun test claude-code/skills`, and update the version, integrity and blob pins here and in `layout.test.ts`. The compiled `diagram-render` picks it up after `darwin-rebuild switch`.
