# Third-Party Notices

virtual-chromo incorporates software from the following third-party projects.
Each component remains under its original license.

## jsproxy (MIT)

- **Project:** [EtherDream/jsproxy](https://github.com/EtherDream/jsproxy)
- **Copyright:** Copyright (c) 2019 EtherDream
- **License:** MIT

**Used in this repository:**

| Path | Notes |
|------|--------|
| `src/worker/index.js` | Cloudflare Worker proxy; derived from upstream `cf-worker/` |

## jsproxy-browser (MIT)

- **Project:** [EtherDream/jsproxy-browser](https://github.com/EtherDream/jsproxy-browser)
- **Copyright:** Copyright (c) 2019 EtherDream
- **License:** MIT

**Used in this repository:**

| Path | Notes |
|------|--------|
| `public/bundle.js` | Minified runtime bundle (Service Worker) |
| `public/bundle.formatted.js` | Beautified reference copy; not loaded at runtime |
| `public/bundle.reconstructed.js` | Reconstructed readable source; not loaded at runtime |
| `public/jsproxy-src/*.js` | Upstream browser-side source copies for reference |
| `public/jsproxy-src/index.vc.js` | Fork of upstream `index.js` for virtual-chromo iframe shell |
| `public/conf.js`, `public/sw.js` | jsproxy configuration / bootstrap patterns |

virtual-chromo-specific layers (`public/bridge.js`, `public/inject.js`, `public/viewer.html`, `docs/`, etc.) are original to this project unless noted otherwise.

---

## vConsole (MIT)

- **Project:** [Tencent/vConsole](https://github.com/Tencent/vConsole)
- **Copyright:** Copyright (C) 2017 THL A29 Limited, a Tencent company
- **License:** MIT
- **Version:** 3.15.1

**Used in this repository:**

| Path | Notes |
|------|--------|
| `public/vendor/vconsole.min.js` | Dist build; loaded into proxied pages when instant-app DevTools Extensions enables vConsole |

---

## MIT License Text (EtherDream / jsproxy & jsproxy-browser)

```
MIT License

Copyright (c) 2019 EtherDream

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
