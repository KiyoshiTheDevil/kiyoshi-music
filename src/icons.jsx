/**
 * Font Awesome Pro 6.7.2 icon wrappers — drop-in replacement for @phosphor-icons/react.
 *
 * weight prop mapping:
 *   "fill" | "bold" | "duotone"  → fa-solid
 *   "regular" | "light" | "thin" | undefined → fa-regular
 */

import React from "react";

// Dummy context so existing <IconContext.Provider> calls don't crash
export const IconContext = React.createContext({});

function fa(name) {
  return function FaIcon({ size, weight, className = "", style, ...rest }) {
    const solid = weight === "fill" || weight === "bold" || weight === "duotone";
    const cls = `${solid ? "fa-solid" : "fa-regular"} fa-${name}${className ? " " + className : ""}`;
    return (
      <i
        className={cls}
        style={{ ...(size ? { fontSize: size } : {}), ...style }}
        aria-hidden="true"
        {...rest}
      />
    );
  };
}

// ── Window controls ──────────────────────────────────────────────────────────
export const Minus              = fa("minus");
export const X                  = fa("xmark");

// ── Playback ─────────────────────────────────────────────────────────────────
export const Play               = fa("play");
export const Pause              = fa("pause");
export const SkipBack           = fa("backward-step");
export const SkipForward        = fa("forward-step");
export const Shuffle            = fa("shuffle");
export const Repeat             = fa("repeat");
export const RepeatOnce         = fa("repeat-1");
export const PlayCircle         = fa("circle-play");

// ── Volume ───────────────────────────────────────────────────────────────────
export const SpeakerX           = fa("volume-xmark");
export const SpeakerLow         = fa("volume-low");
export const SpeakerHigh        = fa("volume-high");

// ── Navigation ───────────────────────────────────────────────────────────────
export const House              = fa("house");
export const Books              = fa("books");
export const MagnifyingGlass    = fa("magnifying-glass");
export const ArrowLeft          = fa("arrow-left");
export const CaretLineLeft      = fa("angles-left");
export const CaretLineRight     = fa("angles-right");
export const CaretUp            = fa("caret-up");
export const CaretDown          = fa("caret-down");
export const CaretLineUp        = fa("angles-up");

// ── Player UI ────────────────────────────────────────────────────────────────
export const Queue              = fa("list");
export const ChatText           = fa("message-lines");
export const ArrowsIn           = fa("compress");
export const ArrowsOut          = fa("expand");

// ── Settings & tools ─────────────────────────────────────────────────────────
export const Gear               = fa("gear");
export const Palette            = fa("palette");
export const Keyboard           = fa("keyboard");
export const PaintBrushBroad    = fa("paintbrush-fine");
export const HardDrives         = fa("hard-drive");
export const Translate          = fa("language");

// ── Content ──────────────────────────────────────────────────────────────────
export const VinylRecord        = fa("record-vinyl");
export const MusicNote          = fa("music");
export const Playlist           = fa("list-music");
export const ImageSquare        = fa("image");
export const Microphone         = fa("microphone");
export const Heart              = fa("heart");
export const Crown              = fa("crown");

// ── Actions ──────────────────────────────────────────────────────────────────
export const Check              = fa("check");
export const CheckCircle        = fa("circle-check");
export const Plus               = fa("plus");
export const DownloadSimple     = fa("download");
export const UploadSimple       = fa("upload");
export const Trash              = fa("trash");
export const PencilSimple       = fa("pencil");
export const ArrowCircleUp      = fa("circle-arrow-up");
export const Copy               = fa("copy");
export const ArrowSquareOut     = fa("arrow-up-right-from-square");
export const ArrowClockwise     = fa("arrow-rotate-right");
export const ArrowsClockwise    = fa("arrows-rotate");
export const Link               = fa("link");
export const PushPin            = fa("thumbtack");
export const ClockCounterClockwise = fa("clock-rotate-left");

// ── Lists & layout ───────────────────────────────────────────────────────────
export const DotsSixVertical    = fa("grip-vertical");
export const DotsThreeVertical  = fa("ellipsis-vertical");

// ── Time & weather (greeting) ────────────────────────────────────────────────
export const SunHorizon         = fa("sun-horizon");
export const Sun                = fa("sun");
export const CloudSun           = fa("cloud-sun");
export const Moon               = fa("moon");
export const MoonStars          = fa("moon-stars");

// ── Status ───────────────────────────────────────────────────────────────────
export const WifiHigh           = fa("wifi");
export const WifiX              = fa("wifi-slash");
export const Bug                = fa("bug");
export const PersonArmsSpread   = fa("universal-access");

// ── Settings icons ────────────────────────────────────────────────────────────
export const TextSize           = fa("text-size");
export const Sliders            = fa("sliders");
export const EyeSlash           = fa("eye-slash");
export const Tag                = fa("tag");
export const CircleHalf         = fa("circle-half-stroke");
export const WaveformLines      = fa("waveform-lines");
export const Sparkles           = fa("wand-magic-sparkles");
export const ShareNodes         = fa("share-nodes");
export const Globe              = fa("globe");
export const Lock               = fa("lock");
export const LockOpen           = fa("lock-open");
