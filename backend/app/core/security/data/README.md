# Common-password corpus (offline)

`10k-most-common.txt` is the offline denylist behind the password policy
(`docs/backend/AUTH_RBAC.md` §7.3). It is loaded from disk on first use, normalized (NFKC + case-fold)
and compared in memory. **No network call is ever made during password validation.**

| | |
|---|---|
| File | `10k-most-common.txt` — stored **byte-identical** to the upstream file (not edited, nothing added) |
| Source | SecLists by Daniel Miessler — `Passwords/Common-Credentials/10k-most-common.txt` |
| Repository | https://github.com/danielmiessler/SecLists |
| Pinned commit | `913b327317496d062bcc7cace524aaad8a693be2` (2026-09-08) |
| Retrieved | 2026-10-17 from `raw.githubusercontent.com` at that commit |
| Size / lines | 73,026 bytes; 10,001 entries |
| SHA-256 | `68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce` |
| License | MIT (reproduced below) |

To update the corpus, replace the file with a newer upstream version, record the new commit, date and
SHA-256 here, and run the backend tests. Do not hand-edit the file.

Note: the password policy has a 10-character minimum, and most entries of a "top 10k" list are
shorter, so only the entries of 10+ characters can ever be the deciding reason a password is refused
(the length rule rejects the rest). A larger corpus (e.g. SecLists' `100k-most-used-passwords-NCSC.txt`)
would be a separate, data-only decision.

## License of the corpus

MIT License

Copyright (c) 2018 Daniel Miessler

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
