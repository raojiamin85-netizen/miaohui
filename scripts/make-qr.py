# 生成「妙回」体验二维码（纯图，供简历 / 作品集使用）
# 跑法：<venv>/Scripts/python.exe -X utf8 make-qr.py
import os
import qrcode
from qrcode.constants import ERROR_CORRECT_H

URL = "https://miaohui-reply.app.workbuddy.host/"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "qr-miaohui.png")

qr = qrcode.QRCode(
    version=None,
    error_correction=ERROR_CORRECT_H,
    box_size=14,
    border=2,
)
qr.add_data(URL)
qr.make(fit=True)

img = qr.make_image(fill_color="#171717", back_color="#FFFFFF").convert("RGB")
img.save(OUT)

print("url   =", URL)
print("file  =", os.path.abspath(OUT))
print("size  =", img.size, "modules =", qr.modules_count)
