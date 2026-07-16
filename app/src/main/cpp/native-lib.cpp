#include <jni.h>
#include <android/log.h>
#include <unistd.h>
#include <atomic>
#include <mutex>
#include <string>
#include <vector>

#include "llama.h"

#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "PocketMind", __VA_ARGS__)

namespace {
std::mutex g_mutex;
llama_model * g_model = nullptr;
llama_context * g_ctx = nullptr;
llama_sampler * g_sampler = nullptr;
int g_model_fd = -1;
std::atomic<bool> g_stop{false};
std::string g_last_error;

void cleanup_locked() {
    if (g_sampler) { llama_sampler_free(g_sampler); g_sampler = nullptr; }
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    if (g_model_fd >= 0) { close(g_model_fd); g_model_fd = -1; }
}

std::string token_piece(const llama_vocab * vocab, llama_token token) {
    std::string result(32, '\0');
    int32_t n = llama_token_to_piece(vocab, token, result.data(), (int32_t) result.size(), 0, true);
    if (n < 0) {
        result.resize((size_t) -n);
        n = llama_token_to_piece(vocab, token, result.data(), (int32_t) result.size(), 0, true);
    }
    if (n <= 0) return {};
    result.resize((size_t) n);
    return result;
}
}

extern "C" JNIEXPORT jstring JNICALL
Java_me_themishka_pocketmind_NativeBridge_runtimeVersion(JNIEnv * env, jclass) {
    return env->NewStringUTF(llama_print_system_info());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_me_themishka_pocketmind_NativeBridge_loadModel(
        JNIEnv *, jclass, jint fd, jint contextSize, jint threads) {
    std::lock_guard<std::mutex> lock(g_mutex);
    cleanup_locked();
    g_last_error.clear();
    g_stop = false;

    g_model_fd = dup(fd);
    if (g_model_fd < 0) {
        g_last_error = "Could not duplicate the Android model file descriptor.";
        return JNI_FALSE;
    }

    if (lseek(g_model_fd, 0, SEEK_SET) < 0) {
        g_last_error = "The selected Android document provider does not expose a seekable GGUF file.";
        cleanup_locked();
        return JNI_FALSE;
    }

    const std::string path = "/proc/self/fd/" + std::to_string(g_model_fd);
    llama_backend_init();

    llama_model_params modelParams = llama_model_default_params();
    modelParams.n_gpu_layers = 0;
    modelParams.use_mmap = false;
    modelParams.use_mlock = false;
    g_model = llama_model_load_from_file(path.c_str(), modelParams);
    if (!g_model) {
        g_last_error = "Prism could not load this GGUF. Close other apps, verify the file is complete, and retry.";
        cleanup_locked();
        return JNI_FALSE;
    }

    llama_context_params ctxParams = llama_context_default_params();
    ctxParams.n_ctx = contextSize > 0 ? (uint32_t) contextSize : 1024;
    ctxParams.n_batch = 64;
    ctxParams.n_ubatch = 64;
    ctxParams.n_threads = threads > 0 ? threads : 4;
    ctxParams.n_threads_batch = ctxParams.n_threads;
    ctxParams.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;

    g_ctx = llama_init_from_model(g_model, ctxParams);
    if (!g_ctx) {
        g_last_error = "Weights loaded, but context allocation failed. Free memory and retry with a smaller context.";
        cleanup_locked();
        return JNI_FALSE;
    }

    llama_sampler_chain_params samplerParams = llama_sampler_chain_default_params();
    g_sampler = llama_sampler_chain_init(samplerParams);
    llama_sampler_chain_add(g_sampler, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(g_sampler, llama_sampler_init_top_p(0.90f, 1));
    llama_sampler_chain_add(g_sampler, llama_sampler_init_temp(0.65f));
    llama_sampler_chain_add(g_sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    return JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL
Java_me_themishka_pocketmind_NativeBridge_unloadModel(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lock(g_mutex);
    cleanup_locked();
}

extern "C" JNIEXPORT void JNICALL
Java_me_themishka_pocketmind_NativeBridge_stopGeneration(JNIEnv *, jclass) {
    g_stop = true;
}

extern "C" JNIEXPORT jstring JNICALL
Java_me_themishka_pocketmind_NativeBridge_lastError(JNIEnv * env, jclass) {
    return env->NewStringUTF(g_last_error.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_me_themishka_pocketmind_NativeBridge_generate(
        JNIEnv * env, jclass, jstring promptValue, jint maxTokens) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_model || !g_ctx || !g_sampler) {
        g_last_error = "No local model is loaded.";
        return env->NewStringUTF("");
    }

    const char * raw = env->GetStringUTFChars(promptValue, nullptr);
    std::string prompt(raw ? raw : "");
    if (raw) env->ReleaseStringUTFChars(promptValue, raw);
    g_stop = false;

    llama_memory_clear(llama_get_memory(g_ctx), true);
    llama_sampler_reset(g_sampler);

    const llama_vocab * vocab = llama_model_get_vocab(g_model);
    int32_t needed = -llama_tokenize(vocab, prompt.c_str(), (int32_t) prompt.size(), nullptr, 0, true, true);
    if (needed <= 0) {
        g_last_error = "Tokenization failed.";
        return env->NewStringUTF("");
    }

    std::vector<llama_token> tokens((size_t) needed);
    int32_t count = llama_tokenize(vocab, prompt.c_str(), (int32_t) prompt.size(), tokens.data(), needed, true, true);
    if (count <= 0) {
        g_last_error = "Tokenization failed.";
        return env->NewStringUTF("");
    }
    tokens.resize((size_t) count);

    llama_batch batch = llama_batch_get_one(tokens.data(), (int32_t) tokens.size());
    if (llama_decode(g_ctx, batch) != 0) {
        g_last_error = "Prompt evaluation failed.";
        return env->NewStringUTF("");
    }

    std::string output;
    const int limit = maxTokens > 0 ? maxTokens : 512;
    for (int i = 0; i < limit && !g_stop; ++i) {
        llama_token token = llama_sampler_sample(g_sampler, g_ctx, -1);
        if (llama_vocab_is_eog(vocab, token)) break;
        output += token_piece(vocab, token);
        llama_sampler_accept(g_sampler, token);
        llama_batch next = llama_batch_get_one(&token, 1);
        if (llama_decode(g_ctx, next) != 0) {
            g_last_error = "Generation stopped because token evaluation failed.";
            break;
        }
    }

    return env->NewStringUTF(output.c_str());
}
