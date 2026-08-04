# Assets

| File | Used by | Spec |
|---|---|---|
| `hero.png` | `README.md` | 2000×1125, ~105 KB. Product banner — dashboard on desktop, sign-in on mobile. |

## Why 2000px

The README renders this at roughly 1000px, so 2000 is 2× — sharp on high-DPI
screens without paying for pixels nobody sees. The original export was
3200×1800 at 1005 KB; resizing and re-compressing cut it to 105 KB with no
visible difference at display size.

This is the first asset that loads on the repository page, so its weight is
worth caring about.

To re-optimise after a new export:

```bash
node -e "
require('./frontend/node_modules/sharp')('assets/hero.png')
  .resize(2000, null, { withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toFile('assets/hero-opt.png')
  .then(i => console.log(i.width + 'x' + i.height, (i.size/1024).toFixed(0) + ' KB'));
"
```

Screenshots go stale faster than code. If the UI changes materially, re-export
rather than leaving a banner showing a version nobody is running.
