"""Builds media/icon-font.woff from media/icon-outline.svg (glyph U+E000).

VS Code product icons must come from a font, and font glyphs are filled shapes:
picosvg turns the SVG strokes into filled outlines, fontTools builds the font.

    python3 -m venv .venv && .venv/bin/pip install picosvg fonttools
    .venv/bin/python scripts/build-icon-font.py
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import SVGPath
from picosvg.svg import SVG

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'media' / 'icon-outline.svg'
TARGET = ROOT / 'media' / 'icon-font.woff'
FAMILY = 'projects-quick-switch'
CODEPOINT = 0xE000
UPM = 1000
VIEWBOX = 16

filled = SVG.parse(str(SOURCE)).topicosvg().tostring()

glyph_pen = TTGlyphPen(None)
scale = UPM / VIEWBOX
# SVG y axis points down, font y axis points up; the baseline sits at the bottom of the viewBox.
pen = TransformPen(Cu2QuPen(glyph_pen, max_err=1.0, reverse_direction=True), (scale, 0, 0, -scale, 0, UPM))
SVGPath.fromstring(filled.encode()).draw(pen)
icon = glyph_pen.glyph()

empty = TTGlyphPen(None).glyph()
builder = FontBuilder(UPM, isTTF=True)
builder.setupGlyphOrder(['.notdef', 'logo'])
builder.setupCharacterMap({CODEPOINT: 'logo'})
builder.setupGlyf({'.notdef': empty, 'logo': icon})
builder.setupHorizontalMetrics({'.notdef': (UPM, 0), 'logo': (UPM, 0)})
builder.setupHorizontalHeader(ascent=UPM, descent=0)
builder.setupNameTable({'familyName': FAMILY, 'styleName': 'Regular'})
builder.setupOS2(sTypoAscender=UPM, sTypoDescender=0, usWinAscent=UPM, usWinDescent=0)
builder.setupPost()
builder.font.flavor = 'woff'
builder.save(str(TARGET))
print(f'{TARGET.relative_to(ROOT)} ({TARGET.stat().st_size} bytes)')
