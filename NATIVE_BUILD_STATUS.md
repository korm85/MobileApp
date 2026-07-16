# PocketMind local-first native build

This branch targets ARM64 Android and the PrismML llama.cpp `prism` branch for local Q2_0 GGUF inference.

Current validation milestone:
- pinned NDK 27.2.12479018
- pinned CMake 3.22.1
- CPU-only ARM64 build
- PrismML llama.cpp fetched during CMake configuration
- JNI model load, generate, stop and unload bridge
- GitHub pull-request CI enabled for compiler diagnostics

The APK is not considered ready until CI produces an artifact and the target GGUF is loaded successfully on the Pixel 10a.
