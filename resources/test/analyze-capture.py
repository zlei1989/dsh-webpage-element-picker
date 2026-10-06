"""量出探针窗口截图里各标记色的行范围，推算页面「真实可见高度」与 emulated viewport 的差。

用法: python analyze-capture.py <png 路径>
标记色:
  #22c55e 顶部绿条（页面 CSS y=0..24）
  #ef4444 底部红条（页面 CSS y=780..820）
  #dbeafe 目标节点填充（CSS y=700..730）
  #1e1e1e 操作栏卡片底色（CSS y=736..770）
截图按设备像素（DPR=2）拍摄，故 CSS = 像素/2。
"""
import sys
from PIL import Image

path = sys.argv[1]
im = Image.open(path).convert('RGB')
W, H = im.size
px = im.load()

MARKS = {
    'green-top(#22c55e)': (0x22, 0xC5, 0x5E),
    'red-bottom(#ef4444)': (0xEF, 0x44, 0x44),
    'node(#dbeafe)': (0xDB, 0xEA, 0xFE),
    'card(#1e1e1e)': (0x1E, 0x1E, 0x1E),
}


def near(c, t, tol=10):
    return abs(c[0] - t[0]) <= tol and abs(c[1] - t[1]) <= tol and abs(c[2] - t[2]) <= tol


# 每种标记色统计命中的行区间（要求该行至少有 40 个命中像素，排除抗锯齿噪点）
for name, rgb in MARKS.items():
    rows = []
    for y in range(H):
        n = 0
        for x in range(0, W, 4):
            if near(px[x, y], rgb):
                n += 1
                if n >= 40:
                    break
        if n >= 40:
            rows.append(y)
    if not rows:
        print(f'{name}: 未出现')
        continue
    # 归并连续区间
    spans = []
    start = prev = rows[0]
    for y in rows[1:]:
        if y != prev + 1:
            spans.append((start, prev))
            start = y
        prev = y
    spans.append((start, prev))
    pretty = ', '.join(f'{a}-{b}px (CSS {a/2:.0f}..{b/2:.0f})' for a, b in spans)
    print(f'{name}: {pretty}')

print(f'图像尺寸: {W}x{H}px = CSS {W/2:.0f}x{H/2:.0f}')
