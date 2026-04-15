# Prompt 示例

> 以下示例展示了不同比例和构图的 prompt 写法。
> 直接用于 `generate_anima_image(prompt=...)` 调用。

## 1) 竖屏 9:16 半身

```
prompt: masterpiece, best quality, highres, newest, year 2025, safe, 1girl, hatsune miku, vocaloid, @fkey, long twintails, aqua hair, aqua eyes, petite, upper body, looking at viewer, smile, holding guitar, stage, spotlight, bokeh, night, neon, rim light, depth of field
neg: worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, bad hands, bad feet, missing fingers, extra fingers, text, watermark, nsfw, explicit
aspect_ratio: 9:16
steps: 20
cfg_scale: 4.5
```

## 2) 横屏 16:9 全身动态

```
prompt: best quality, highres, newest, year 2025, safe, 1girl, @toridamono, short hair, brown hair, red eyes, small breasts, full body, dynamic pose, running, wind, motion blur, dramatic angle, sunset, backlight, dust particles
neg: worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, bad hands, bad feet, extra fingers, missing fingers, text, watermark, nsfw, explicit, bad knees
aspect_ratio: 16:9
steps: 35
cfg_scale: 4.5
```

## 3) 超宽 21:9 风景+小人

```
prompt: good quality, highres, newest, year 2025, safe, 1girl, @guweiz, long hair, white dress, wide shot, small figure, landscape, mountains, river, clouds, golden hour, volumetric light, haze
neg: worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, text, watermark, nsfw
aspect_ratio: 21:9
steps: 20
cfg_scale: 4.0
```

## 4) 方形 1:1 特写

```
prompt: masterpiece, best quality, newest, year 2025, safe, 1girl, @ilya kuvshinov, silver hair, bob cut, blue eyes, portrait, close-up, looking at viewer, soft smile, hand on chin, natural light, white background, simple background
neg: worst quality, low quality, blurry, bad anatomy, bad hands, extra fingers, missing fingers, nsfw
aspect_ratio: 1:1
steps: 20
cfg_scale: 4.5
```
