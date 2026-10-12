import urllib.request, io, threading
class HTTPRangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests, with a block cache."""
    def __init__(self, url, block=1<<20):
        self.url, self.block, self.pos, self.cache = url, block, 0, {}
        req = urllib.request.Request(url, method='HEAD')
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers['Content-Length'])
        self.bytes_read = 0
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def _get(self, b):
        if b in self.cache: return self.cache[b]
        a = b * self.block; e = min(self.size, a + self.block) - 1
        for attempt in range(5):
            try:
                req = urllib.request.Request(self.url, headers={'Range': f'bytes={a}-{e}'})
                with urllib.request.urlopen(req, timeout=120) as r: d = r.read()
                break
            except Exception as ex:
                if attempt == 4: raise
        self.bytes_read += len(d)
        if len(self.cache) > 256: self.cache.clear()
        self.cache[b] = d
        return d
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            b = self.pos // self.block; o = self.pos - b * self.block
            d = self._get(b)[o:o + n]
            out += d; self.pos += len(d); n -= len(d)
            if not d: break
        return bytes(out)
    def readinto(self, buf):
        d = self.read(len(buf)); buf[:len(d)] = d; return len(d)
