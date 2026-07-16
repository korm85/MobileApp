# PocketMind local runtime contract

Primary acceptance target: `Ternary-Bonsai-8B-Q2_0_g64.gguf` on Pixel 10a.

The Android UI now owns persistent Storage Access Framework model selection, GGUF header inspection, system light/dark behavior, human-friendly response rendering, and artifact preview cards.

The remaining critical path is native inference:

1. Vendor the PrismML-compatible llama.cpp source at a pinned commit.
2. Build arm64-v8a with Android NDK and NEON enabled.
3. Expose JNI methods for load, unload, generate, cancel, metadata and token callbacks.
4. Resolve content URIs to a runtime-readable descriptor or app-local mapped file without duplicating multi-gigabyte models when avoidable.
5. Use 2048 context, conservative batch size and automatic thread selection as Pixel 10a defaults.
6. Stream UTF-8 token fragments to the UI and provide immediate cancellation.
7. Detect OOM/native errors and return actionable messages instead of crashing.

The app must not report a model as loaded until the JNI runtime confirms successful tensor loading.