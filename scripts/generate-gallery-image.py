#!/usr/bin/env python3
"""Generate the privacy-safe Pi package gallery image."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 2
W, H = 1600 * SCALE, 900 * SCALE

def font(path, size): return ImageFont.truetype(path, size * SCALE)
SANS = "/System/Library/Fonts/SFNS.ttf"
MONO = "/System/Library/Fonts/SFNSMono.ttf"

def text(draw, xy, value, *, size=24, color=(224,229,238), mono=False, anchor=None):
    draw.text((xy[0]*SCALE,xy[1]*SCALE),value,font=font(MONO if mono else SANS,size),fill=color,anchor=anchor)

def rr(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(tuple(v*SCALE for v in box),radius=radius*SCALE,fill=fill,outline=outline,width=width*SCALE)

def line(draw, points, fill, width=1): draw.line(tuple(v*SCALE for point in points for v in point),fill=fill,width=width*SCALE)

img=Image.new("RGB",(W,H),(10,14,22));d=ImageDraw.Draw(img)
# subtle blue glow and grid
for radius in range(720,40,-20):
    alpha=(720-radius)/720
    color=(10+int(10*alpha),20+int(18*alpha),34+int(30*alpha))
    d.ellipse(((800-radius)*SCALE,(-210-radius//3)*SCALE,(800+radius)*SCALE,(-210+radius*2)*SCALE),fill=color)
for x in range(0,1601,80): line(d,[(x,0),(x,900)],(17,23,34))
for y in range(0,901,80): line(d,[(0,y),(1600,y)],(17,23,34))

rr(d,(62,44,280,88),22,(26,39,63),outline=(57,87,137))
text(d,(86,57),"PI PACKAGE",size=17,color=(130,180,255),mono=True)
text(d,(65,116),"Paste screenshots. Keep prompts clean.",size=54,color=(247,249,252))
text(d,(68,181),"pi-image-view replaces temporary clipboard paths with stable, clickable image markers.",size=23,color=(151,161,178))

PANEL_Y1,PANEL_Y2=250,730

def panel(x1,x2,label,title,accent):
    rr(d,(x1,PANEL_Y1,x2,PANEL_Y2),22,(18,24,35),outline=(48,58,74),width=2)
    rr(d,(x1+22,PANEL_Y1+20,x1+118,PANEL_Y1+53),16,accent)
    text(d,(x1+70,PANEL_Y1+36),label,size=14,color=(255,255,255),mono=True,anchor="mm")
    text(d,(x1+136,PANEL_Y1+24),title,size=20,color=(213,219,229))
    for i,c in enumerate([(255,95,86),(255,189,46),(39,201,63)]): d.ellipse(((x2-78+i*20)*SCALE,(PANEL_Y1+31)*SCALE,(x2-68+i*20)*SCALE,(PANEL_Y1+41)*SCALE),fill=c)

panel(65,770,"BEFORE","Pi default paste",(132,58,58))
panel(830,1535,"AFTER","with pi-image-view",(37,98,162))

# Before editor
text(d,(94,325),"Your prompt",size=16,color=(113,124,142),mono=True)
rr(d,(92,354,743,584),14,(12,17,25),outline=(50,59,73))
text(d,(116,382),"/var/folders/0n/7wpp6lb56w3gbydzk/",size=18,color=(255,135,126),mono=True)
text(d,(116,416),"T/pi-clipboard-7f32c1a9-3b44-4d2f.png",size=18,color=(255,135,126),mono=True)
text(d,(116,470),"Can you review this checkout error?",size=19,color=(225,230,238),mono=True)
line(d,[(116,516),(710,516)],(42,51,64))
text(d,(116,540),"Long path in the editor and transcript",size=15,color=(158,169,186),mono=True)
text(d,(94,628),"Path noise obscures the actual request",size=18,color=(205,143,139))

# After preview widget
text(d,(858,319),"clipboard.png",size=15,color=(115,166,232),mono=True)
rr(d,(858,346,1507,486),14,(247,249,252),outline=(92,111,138))
text(d,(882,365),"Checkout settings · Demo",size=20,color=(30,38,50))
rr(d,(882,406,1120,456),9,(232,238,247))
text(d,(900,420),"Payment method",size=14,color=(73,85,103))
text(d,(900,441),"Visa ending in 4242",size=13,color=(35,46,62))
rr(d,(1140,406,1348,456),9,(232,238,247))
text(d,(1158,420),"Order total",size=14,color=(73,85,103))
text(d,(1158,441),"$128.40 USD",size=13,color=(35,46,62))
rr(d,(1366,408,1484,454),9,(45,105,218))
text(d,(1425,431),"Pay now",size=14,color=(255,255,255),anchor="mm")

# After editor and status
rr(d,(858,512,1507,626),14,(12,17,25),outline=(50,59,73))
text(d,(884,537),"[Image #1]",size=20,color=(105,174,255),mono=True)
text(d,(884,575),"Can you review this checkout error?",size=19,color=(225,230,238),mono=True)
text(d,(868,652),"gpt-5.6-sol  OpenAI  medium",size=14,color=(163,174,191),mono=True)
line(d,[(858,679),(1507,679)],(45,56,72))
text(d,(868,694),"pi-image-view  |  main  |  0.0%/1.0M",size=14,color=(132,177,230),mono=True)

# comparison arrow
rr(d,(770,435,830,495),30,(31,48,77),outline=(62,93,145))
text(d,(800,465),"→",size=30,color=(130,180,255),anchor="mm")

# Feature chips
chips=[("Compact 480px",65,305),("Clickable history",325,625),("Atomic markers",645,925),("No path leakage",945,1265),("Detail on demand",1285,1535)]
for label,x1,x2 in chips:
    rr(d,(x1,785,x2,842),28,(19,29,45),outline=(48,69,101))
    d.ellipse(((x1+20)*SCALE,804*SCALE,(x1+32)*SCALE,816*SCALE),fill=(74,180,112))
    text(d,(x1+46,801),label,size=17,color=(194,204,219))

text(d,(65,868),"pi install npm:pi-image-view",size=16,color=(111,161,225),mono=True)
text(d,(1535,868),"github.com/alchemistklk/pi-image-view",size=16,color=(143,154,172),mono=True,anchor="ra")

img.resize((1600,900),Image.Resampling.LANCZOS).save(ROOT/"screenshot.png",optimize=True)
print(ROOT/"screenshot.png")
