# Security Policy

## Supported Versions

Security fixes are applied to the latest published release on the default branch (`master`). Older tags are not patched.

| Version | Supported |
| ------- | --------- |
| Latest release on `master` | Yes |
| Older releases / tags | No |

## Reporting a Vulnerability

Please report security issues **privately**. Do not open a public GitHub issue for vulnerabilities.

Preferred channel:

1. Use [GitHub private vulnerability reporting](https://github.com/KazeKaze93/sd-comfyui-style-organizer/security/advisories/new) for this repository.
2. If that form is unavailable, contact the maintainer privately via the GitHub profile linked from this repository and include a clear description, impact, and steps to reproduce.

You should expect an acknowledgment when the report is received. If a fix is warranted, it will be coordinated with you before any public disclosure.

## Scope

This custom node registers HTTP endpoints under `/style_grid/*` on ComfyUI’s own `PromptServer`. Several of those routes **mutate** user data (styles, presets, usage, thumbnails, backups, imports).

They inherit ComfyUI’s process and network exposure. **Do not expose a ComfyUI instance that loads this node to untrusted networks** (or to the public internet) without the same access controls you would apply to ComfyUI itself. Treat the Style Grid API as part of the local ComfyUI trust boundary, not as a hardened multi-user service.
