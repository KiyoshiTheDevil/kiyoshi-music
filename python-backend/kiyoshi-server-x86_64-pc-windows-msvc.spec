# -*- mode: python ; coding: utf-8 -*-


import importlib.util as _iu
_ytm = _iu.find_spec('ytmusicapi')
_ytm_locales = __import__('os').path.join(__import__('os').path.dirname(_ytm.origin), 'locales')

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=[(_ytm_locales, 'ytmusicapi/locales')],
    hiddenimports=["pykakasi", "jaconv"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='kiyoshi-server-x86_64-pc-windows-msvc',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
