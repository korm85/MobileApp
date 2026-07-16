package me.themishka.pocketmind;

final class NativeBridge {
    static {
        System.loadLibrary("pocketmind");
    }

    private NativeBridge() {}

    static native String runtimeVersion();
    static native boolean loadModel(int fileDescriptor, int contextSize, int threads);
    static native void unloadModel();
    static native String generate(String prompt, int maxTokens);
    static native void stopGeneration();
    static native String lastError();
}
