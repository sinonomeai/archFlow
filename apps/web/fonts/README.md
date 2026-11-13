# HarmonyOS Sans SC（Web 子集）

自托管字体文件，避免依赖用户本机是否安装了鸿蒙字体。

- 来源：Huawei HarmonyOS Sans v2
  <https://developer.huawei.com/images/download/next/HarmonyOS-Sans-v2.zip>
- 授权：HarmonyOS Sans Font License（允许免费商用与再分发）
- 字重：400 / 500 / 600（700 未声明，避免无用的首屏下载）
- 子集字符集：GB2312 一级汉字 + 常用符号 + 本项目源码中出现的全部字符（约 4500 字）
- 格式：WOFF2，`font-display: swap`
- 生成工具：fontTools `pyftsubset`

## 重新生成

```bash
pyftsubset HarmonyOS_SansSC_Regular.ttf \
  --text-file=chars.txt \
  --flavor=woff2 \
  --no-hinting \
  --layout-features='*' \
  --output-file=HarmonyOS_Sans_SC_Regular.woff2
```

Medium / Semibold 同理。`chars.txt` 由项目源码与 GB2312 一级字表合并生成。
若产品中出现罕见字，需要扩大子集后重新生成。
