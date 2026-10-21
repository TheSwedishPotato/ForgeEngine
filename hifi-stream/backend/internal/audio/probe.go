// Package audio reads technical metadata (sample rate, bit depth, length)
// from FLAC and WAV headers without decoding any audio.
package audio

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

type Info struct {
	Codec      string // "flac" or "wav"
	SampleRate int
	BitDepth   int
	Channels   int
	DurationMs int64
}

var ErrUnsupported = errors.New("unsupported audio format: upload FLAC or WAV")

// ContentType returns the MIME type browsers expect for a codec.
func ContentType(codec string) string {
	if codec == "wav" {
		return "audio/wav"
	}
	return "audio/flac"
}

// Probe inspects the start of r and leaves it positioned at an arbitrary offset.
func Probe(r io.ReadSeeker) (Info, error) {
	var magic [4]byte
	if _, err := io.ReadFull(r, magic[:]); err != nil {
		return Info{}, ErrUnsupported
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return Info{}, err
	}
	switch {
	case string(magic[:]) == "fLaC", string(magic[:3]) == "ID3":
		return probeFLAC(r)
	case string(magic[:]) == "RIFF":
		return probeWAV(r)
	}
	return Info{}, ErrUnsupported
}

func probeFLAC(r io.ReadSeeker) (Info, error) {
	var hdr [10]byte
	if _, err := io.ReadFull(r, hdr[:4]); err != nil {
		return Info{}, ErrUnsupported
	}
	// Some taggers prepend an ID3v2 block to FLAC files; skip it.
	if string(hdr[:3]) == "ID3" {
		if _, err := io.ReadFull(r, hdr[4:]); err != nil {
			return Info{}, ErrUnsupported
		}
		size := int64(hdr[6]&0x7f)<<21 | int64(hdr[7]&0x7f)<<14 | int64(hdr[8]&0x7f)<<7 | int64(hdr[9]&0x7f)
		skip := 10 + size
		if hdr[5]&0x10 != 0 {
			skip += 10 // footer present
		}
		if _, err := r.Seek(skip, io.SeekStart); err != nil {
			return Info{}, err
		}
		if _, err := io.ReadFull(r, hdr[:4]); err != nil {
			return Info{}, ErrUnsupported
		}
	}
	if string(hdr[:4]) != "fLaC" {
		return Info{}, ErrUnsupported
	}

	var block [4]byte
	if _, err := io.ReadFull(r, block[:]); err != nil {
		return Info{}, fmt.Errorf("flac: truncated header")
	}
	length := int(block[1])<<16 | int(block[2])<<8 | int(block[3])
	if block[0]&0x7f != 0 || length < 34 {
		return Info{}, fmt.Errorf("flac: first metadata block is not STREAMINFO")
	}
	var si [34]byte
	if _, err := io.ReadFull(r, si[:]); err != nil {
		return Info{}, fmt.Errorf("flac: truncated STREAMINFO")
	}
	// Bytes 10..17 pack: sample rate (20 bits), channels-1 (3), bits-per-sample-1 (5), total samples (36).
	v := binary.BigEndian.Uint64(si[10:18])
	info := Info{
		Codec:      "flac",
		SampleRate: int(v >> 44),
		Channels:   int((v>>41)&0x7) + 1,
		BitDepth:   int((v>>36)&0x1f) + 1,
	}
	total := int64(v & 0xFFFFFFFFF)
	if info.SampleRate == 0 {
		return Info{}, fmt.Errorf("flac: invalid sample rate")
	}
	if total == 0 {
		return Info{}, fmt.Errorf("flac: total sample count missing; re-encode the file with flac or ffmpeg")
	}
	info.DurationMs = total * 1000 / int64(info.SampleRate)
	return info, nil
}

func probeWAV(r io.ReadSeeker) (Info, error) {
	var riff [12]byte
	if _, err := io.ReadFull(r, riff[:]); err != nil || string(riff[8:12]) != "WAVE" {
		return Info{}, ErrUnsupported
	}
	info := Info{Codec: "wav"}
	var blockAlign int64
	for {
		var ch [8]byte
		if _, err := io.ReadFull(r, ch[:]); err != nil {
			return Info{}, fmt.Errorf("wav: no data chunk found")
		}
		id := string(ch[:4])
		size := int64(binary.LittleEndian.Uint32(ch[4:]))
		consumed := int64(0)
		switch id {
		case "fmt ":
			if size < 16 {
				return Info{}, fmt.Errorf("wav: fmt chunk too short")
			}
			var f [16]byte
			if _, err := io.ReadFull(r, f[:]); err != nil {
				return Info{}, fmt.Errorf("wav: truncated fmt chunk")
			}
			consumed = 16
			format := binary.LittleEndian.Uint16(f[0:2])
			if format != 1 && format != 3 && format != 0xFFFE {
				return Info{}, fmt.Errorf("wav: only PCM WAV is supported")
			}
			info.Channels = int(binary.LittleEndian.Uint16(f[2:4]))
			info.SampleRate = int(binary.LittleEndian.Uint32(f[4:8]))
			blockAlign = int64(binary.LittleEndian.Uint16(f[12:14]))
			info.BitDepth = int(binary.LittleEndian.Uint16(f[14:16]))
		case "data":
			if blockAlign == 0 || info.SampleRate == 0 {
				return Info{}, fmt.Errorf("wav: data chunk before fmt chunk")
			}
			info.DurationMs = size / blockAlign * 1000 / int64(info.SampleRate)
			return info, nil
		}
		// Chunks are padded to an even length.
		if _, err := r.Seek(size-consumed+size%2, io.SeekCurrent); err != nil {
			return Info{}, err
		}
	}
}
