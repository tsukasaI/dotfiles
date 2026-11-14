# vendor

- `elk.bundled.js`: `lib/elk.bundled.js` from elkjs 0.12.1 (https://registry.npmjs.org/elkjs/-/elkjs-0.12.1.tgz, integrity `sha512-IhMYKHE4S2vtx0QrhBP3lYOIKDeIiJXBrdq9MGYkuB8ZHqhrBnHNfSUndjXFewrX1CPK8chwq+2NA0K0hliYuw==`), unmodified. License: EPL-2.0 OR GPL-3.0-or-later, see `LICENSE.md` (copied from the same tarball). Source: https://github.com/kieler/elkjs
- Vendored rather than installed, so `nix-darwin/diagram-render.nix` builds with no npm fetch. To bump: download the tarball, check it against the registry's `dist.integrity`, replace both files and update this line.
