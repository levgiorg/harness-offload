# Security

Code Offload sends file contents and command output to the worker backends you configure. Review
which providers you use and whether they train on prompts.

Safeguards: secret-path refusal (`privacy.secret_globs`), credential redaction, deny-all worker
permissions (the explorer may only read/grep/glob inside the project), `OFFLOAD_DISABLE=1` for
workers, fail-open hooks, API keys stored with mode 600.

Please report vulnerabilities privately via GitHub Security Advisories on OWNER/code-offload.
