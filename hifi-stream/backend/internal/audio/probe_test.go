package audio

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func flacHeader(sampleRate, channels, bits int, total uint64) []byte {
	var b bytes.Buffer
	b.WriteString("fLaC")
	b.Write([]byte{0x80, 0, 0, 34}) // last block, STREAMINFO, length 34
	si := make([]byte, 34)
	v := uint64(sampleRate)<<44 | uint64(channels-1)<<41 | uint64(bits-1)<<36 | total
	binary.BigEndian.PutUint64(si[10:18], v)
	b.Write(si)
	return b.Bytes()
}

func TestProbeFLAC(t *testing.T) {
	info, err := Probe(bytes.NewReader(flacHeader(96000, 2, 24, 96000*180)))
	if err != nil {
		t.Fatal(err)
	}
	want := Info{Codec: "flac", SampleRate: 96000, Channels: 2, BitDepth: 24, DurationMs: 180000}
	if info != want {
		t.Fatalf("got %+v, want %+v", info, want)
	}
}

func TestProbeFLACWithID3(t *testing.T) {
	tag := []byte{'I', 'D', '3', 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5}
	info, err := Probe(bytes.NewReader(append(tag, flacHeader(44100, 2, 16, 44100)...)))
	if err != nil {
		t.Fatal(err)
	}
	if info.SampleRate != 44100 || info.BitDepth != 16 || info.DurationMs != 1000 {
		t.Fatalf("unexpected %+v", info)
	}
}

func TestProbeWAV(t *testing.T) {
	var b bytes.Buffer
	le := binary.LittleEndian
	b.WriteString("RIFF")
	binary.Write(&b, le, uint32(0))
	b.WriteString("WAVE")
	b.WriteString("LIST") // an odd-sized chunk that must be skipped with padding
	binary.Write(&b, le, uint32(3))
	b.Write([]byte{1, 2, 3, 0})
	b.WriteString("fmt ")
	binary.Write(&b, le, uint32(16))
	binary.Write(&b, le, uint16(1))          // PCM
	binary.Write(&b, le, uint16(2))          // channels
	binary.Write(&b, le, uint32(192000))     // sample rate
	binary.Write(&b, le, uint32(192000*2*3)) // byte rate
	binary.Write(&b, le, uint16(6))          // block align
	binary.Write(&b, le, uint16(24))         // bits
	b.WriteString("data")
	binary.Write(&b, le, uint32(192000*6*2)) // two seconds

	info, err := Probe(bytes.NewReader(b.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	want := Info{Codec: "wav", SampleRate: 192000, Channels: 2, BitDepth: 24, DurationMs: 2000}
	if info != want {
		t.Fatalf("got %+v, want %+v", info, want)
	}
}

func TestProbeRejectsMP3(t *testing.T) {
	if _, err := Probe(bytes.NewReader([]byte{0xFF, 0xFB, 0x90, 0x00, 0, 0})); err != ErrUnsupported {
		t.Fatalf("expected ErrUnsupported, got %v", err)
	}
}
