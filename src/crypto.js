// Small, original protocol helpers. MD5 is required by the server's public-key
// query signature; HTTPS and RSA provide credential transport protection.
const SolarCrypto = (() => {
  function md5(text) {
    const bytes = Array.from(unescape(encodeURIComponent(text)), c => c.charCodeAt(0));
    const bitLength = bytes.length * 8;
    bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLength / 2 ** (8 * i)) & 255);
    const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
    const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
    let h = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
    for (let start = 0; start < bytes.length; start += 64) {
      const words = Array.from({ length: 16 }, (_, i) => bytes[start+i*4] | bytes[start+i*4+1]<<8 | bytes[start+i*4+2]<<16 | bytes[start+i*4+3]<<24);
      let [a,b,c,d] = h;
      for (let i = 0; i < 64; i++) {
        const round = Math.floor(i / 16);
        const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
        const g = round === 0 ? i : round === 1 ? (5*i+1)%16 : round === 2 ? (3*i+5)%16 : (7*i)%16;
        const x = (a + f + constants[i] + words[g]) | 0, s = shifts[round*4+i%4];
        const next = (b + ((x << s) | (x >>> (32-s)))) | 0;
        a = d; d = c; c = b; b = next;
      }
      h = h.map((v,i) => (v + [a,b,c,d][i]) | 0);
    }
    return h.map(v => [0,8,16,24].map(s => ((v >>> s) & 255).toString(16).padStart(2,"0")).join("")).join("");
  }
  // Self-contained so it can execute in an isolated local WKWebView with a
  // cryptographically secure random source. No downloaded scripts or pages.
  function rsaEncrypt(password, publicKey, randomBytes) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function decode(s) {
      s = s.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new Error("Invalid public key");
      let bits=0, value=0; const out=[];
      for (const c of s.replace(/=/g,"")) {
        value = (value<<6) | alphabet.indexOf(c); bits+=6;
        if (bits>=8) { bits-=8; out.push((value>>>bits)&255); }
      }
      return out;
    }
    function encode(bytes) {
      let out="";
      for(let i=0;i<bytes.length;i+=3) {
        const v=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);
        out+=alphabet[(v>>>18)&63]+alphabet[(v>>>12)&63]+(i+1<bytes.length?alphabet[(v>>>6)&63]:"=")+(i+2<bytes.length?alphabet[v&63]:"=");
      }
      return out;
    }
    const der=decode(publicKey);
    function tlv(pos) {
      const tag=der[pos++]; let len=der[pos++];
      if (len&128) {
        const count=len&127; if(!count||count>4) throw new Error("Invalid DER length");
        len=0; for(let i=0;i<count;i++)len=len*256+der[pos++];
      }
      if (!Number.isFinite(len)||pos+len>der.length) throw new Error("Invalid DER");
      return {tag,start:pos,end:pos+len};
    }
    let seq=tlv(0); if(seq.tag!==48)throw new Error("Invalid public key sequence");
    let item=tlv(seq.start);
    if(item.tag===48) { // SubjectPublicKeyInfo: algorithm OID followed by BIT STRING.
      const algorithm=der.slice(item.start,item.end).map(n=>n.toString(16).padStart(2,"0")).join("");
      if(algorithm!=="06092a864886f70d0101010500")throw new Error("Unsupported public key algorithm");
      const bit=tlv(item.end);if(bit.tag!==3||der[bit.start]!==0)throw new Error("Invalid key bit string");
      seq=tlv(bit.start+1);item=tlv(seq.start);
    }
    if(item.tag!==2)throw new Error("Invalid RSA modulus");
    let modulus=der.slice(item.start,item.end);while(modulus[0]===0)modulus.shift();
    const exp=tlv(item.end);if(exp.tag!==2)throw new Error("Invalid RSA exponent");
    const bigint=b=>BigInt("0x"+b.map(n=>n.toString(16).padStart(2,"0")).join(""));
    const n=bigint(modulus),e=bigint(der.slice(exp.start,exp.end)),k=modulus.length;
    if(k<256||k>1024||e<3n||e>4294967295n)throw new Error("Unsupported RSA key");
    const message=Array.from(unescape(encodeURIComponent(password)),c=>c.charCodeAt(0));
    if(message.length>k-11)throw new Error("Password too long for RSA key");
    const padding=[];let attempts=0;
    while(padding.length<k-message.length-3) {
      if(attempts++>20)throw new Error("Secure random failed");
      const random=randomBytes(k);
      if(!Array.isArray(random)&&!(random instanceof Uint8Array))throw new Error("Secure random unavailable");
      for(const b of random)if(Number.isInteger(b)&&b>0&&b<=255&&padding.length<k-message.length-3)padding.push(b);
    }
    let x=bigint([0,2,...padding,0,...message]),exponent=e,result=1n;
    while(exponent>0n){if(exponent&1n)result=result*x%n;x=x*x%n;exponent>>=1n;}
    let hex=result.toString(16).padStart(k*2,"0");
    return encode(Array.from({length:k},(_,i)=>parseInt(hex.slice(i*2,i*2+2),16)));
  }
  return { md5, rsaEncrypt };
})();
if (typeof module !== "undefined") module.exports = SolarCrypto;
