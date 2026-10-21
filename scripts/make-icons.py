from PIL import Image, ImageDraw
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((16, 16, S - 16, S - 16), radius=110, fill=(201, 100, 66, 255))
# magnifier
cx, cy, r = 220, 220, 112
d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 255), width=40)
d.line((cx + 80, cy + 80, 400, 400), fill=(255, 255, 255, 255), width=48)
d.ellipse((400 - 24, 400 - 24, 400 + 24, 400 + 24), fill=(255, 255, 255, 255))
# text lines inside lens
d.rounded_rectangle((170, 190, 270, 208), radius=9, fill=(255, 255, 255, 255))
d.rounded_rectangle((170, 232, 240, 250), radius=9, fill=(255, 255, 255, 255))
for n in (16, 32, 48, 128):
    img.resize((n, n), Image.LANCZOS).save(os.path.join(out, f"icon{n}.png"))
print("ok")
