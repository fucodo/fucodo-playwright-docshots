# Is the top of the page visible? The red header bar must be in the first rows of the screenshot.
import glob, sys
from PIL import Image
bad = 0
for f in sorted(glob.glob('Documentation/Images/Screenshots/scroll-top-*/*.png')):
    if '.clean.' in f: continue
    im = Image.open(f).convert('RGB'); px = im.load()
    reds = sum(1 for x in range(0, im.width, 4) if px[x, 3][0] > 150 and px[x, 3][1] < 60)
    ok = reds > im.width // 4 * 0.5
    bad += not ok
    print(('✔' if ok else '✘'), f)
sys.exit(1 if bad else 0)
