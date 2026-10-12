# TrustTunnel Client Compatibility

Upstream: MetaCubeX/mihomo v1.19.32, commit
`88dcbf7f1614a67c3b36b848ee3592dfa92ada36`, GPL-3.0.

`mihomo-client-random-prefix.patch` adds the optional `client-random-prefix`
hexadecimal field to the TrustTunnel outbound. Existing pilot servers require
this ClientHello.random prefix. No server configuration is changed.

When present, the first 1 to 16 bytes are replaced using the existing uTLS
ClientHello API. The remainder retains its random value. Certificate and
hostname verification remain enabled, or an explicitly imported certificate
pin is checked. The ordinary upstream code path is unchanged without a prefix.
The option applies to the HTTP/2 transport used by this pilot, not QUIC.

Tests capture the actual ClientHello on a pipe and verify the prefix and random
suffix. Integration checks separately test successful connections and rejection
of an incorrect certificate pin. This is a compatibility patch, not a security
audit or a new cryptographic protocol.

Build with `scripts/build-core.ps1`. The build writes a SHA-256 metadata file
beside each binary. Distribute this patch, pinned upstream source and build
instructions with binaries as corresponding source.
