cmake_minimum_required(VERSION 3.22.1)
project(pocketmind_native LANGUAGES C CXX)

include(FetchContent)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)
set(GGML_CCACHE OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    prism_llama
    GIT_REPOSITORY https://github.com/PrismML-Eng/llama.cpp.git
    GIT_TAG prism
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(prism_llama)

add_library(pocketmind SHARED native-lib.cpp)

target_include_directories(pocketmind PRIVATE
    ${prism_llama_SOURCE_DIR}/include
    ${prism_llama_SOURCE_DIR}/ggml/include
)

target_compile_options(pocketmind PRIVATE
    -O3
    -ffast-math
    -fvisibility=hidden
)

target_link_libraries(pocketmind
    llama
    ggml
    android
    log
)

target_compile_features(pocketmind PRIVATE cxx_std_17)
