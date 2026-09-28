# BESing Security & Safe Agent Connection Manifesto

**Document Version:** 1.1.0  
**Scope:** Universal (Userscripts & Web Extensions)  

---

## 1. Core Security Paradigm: Safe Authenticated Connections

The foundational security model of **BESing** is based on **Safe & Authenticated Connections**. Rather than dogmatically prohibiting live code updates, security is achieved by ensuring that:
1. **Targeted Agent Authorization:** Any dynamic script or state modification must originate exclusively from verified, authenticated endpoints (such as a local AI agent on `http://127.0.0.1` or a cryptographically signed remote endpoint).
2. **Channel Integrity:** Connections to agents utilize CORS restrictions, Bearer authentication tokens, and origin validation to eliminate man-in-the-middle or hostile website tampering.
3. **Execution Sandboxing:** Scripts execute within the extension/userscript context and render UI strictly within an isolated Shadow DOM boundary, preventing malicious host page scripts from reading manager credentials or hijacking agent commands.

---

## 2. In-Depth Security Guarantees

### 2.1 Authorized Agent Push/Pull Channels
- The `BESSyncEngine` enforces an explicit whitelist of allowed agent URLs (by default `http://127.0.0.1:*` or user-configured hosts).
- Requests from arbitrary third-party websites or injected page scripts cannot trigger agent sync commands or forge state pushes.
- Authentication tokens (when configured) are transmitted via secure `Authorization: Bearer <TOKEN>` headers.

### 2.2 Shadow DOM Encapsulation
- All UI components (the desktop pet widget, the anchored bubble panel, and sub-script overlays) mount inside an isolated **Shadow Root**.
- **Style Isolation:** Page CSS resets and styles cannot break BESing components.
- **Data Protection:** Host page JavaScript cannot access internal storage, API tokens, or agent sync logs via standard DOM selectors.

### 2.3 Safe Storage & Context Boundaries
- Storage operations route through `BESAdapter` using native sandboxed storage (`GM_getValue` / `chrome.storage.local`).
- Neither the agent authentication keys nor the blocklists are ever exposed to the host page's global `window` object.

### 2.4 Controlled Dynamic Script Registration
- When an AI agent pushes an updated script:
  - The script payload is parsed as an explicit module object with lifecycle hooks (`init`, `destroy`, `matches`).
  - The registry tracks execution instances cleanly, ensuring that teardown (`destroy`) is reliably executed before a new version is instantiated.
  - Scripts are executed within the sandboxed extension context, not injected into the host page's unsafe `window` scope.
