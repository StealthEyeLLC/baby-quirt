{
  "targets": [
    {
      "target_name": "peer_cred",
      "sources": ["native/src/peer_cred.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags!": ["-fno-exceptions"],
      "cxxflags!": ["-fno-exceptions"]
    }
  ]
}
