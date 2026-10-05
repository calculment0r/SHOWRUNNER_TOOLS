// SHOWRUNNER — les fonctions mathématiques que Plaits appelle, sans bibliothèque C
// (compilation -ffreestanding vers WebAssembly). En double précision, par
// réduction d'argument et séries de Taylor (exp, sin, cos) ou d'artanh (log) ;
// Plaits ne s'en sert qu'au calcul de coefficients (filtres exacts, accords) :
// la justesse prime sur la vitesse. memset/memcpy/memmove : compilés sans les
// fonctions intégrées (-fno-builtin), sinon le compilateur rappellerait memset
// dans memset.
#include <stddef.h>
#include <stdint.h>

namespace {
const double LN2 = 0.69314718055994530942;
const double PI = 3.14159265358979323846;
inline double deux_puissance(int e) { union { double d; uint64_t u; } v; v.u = (uint64_t)(e + 1023) << 52; return v.d; }
inline double sin_reduit(double y) { double y2 = y * y, t = y, s = y; for (int i = 1; i < 10; ++i) { t *= -y2 / ((2 * i) * (2 * i + 1)); s += t; } return s; }
inline double cos_reduit(double y) { double y2 = y * y, t = 1, s = 1; for (int i = 1; i < 10; ++i) { t *= -y2 / ((2 * i - 1) * (2 * i)); s += t; } return s; }
// x = q·π/2 + y, |y| ≤ π/4
inline void reduire(double x, int* q, double* y) {
  double k = __builtin_floor(x / (2 * PI) + 0.5);
  double r = x - k * 2 * PI;
  double qq = __builtin_floor(r / (PI / 2) + 0.5);
  *y = r - qq * (PI / 2);
  *q = ((int)qq) & 3;
}
}

extern "C" {
double exp(double x) {
  if (x != x) return x;
  if (x > 709.0) return __builtin_inf();
  if (x < -745.0) return 0.0;
  double k = __builtin_floor(x / LN2 + 0.5), r = x - k * LN2, t = 1, s = 1;
  for (int i = 1; i < 16; ++i) { t *= r / i; s += t; }
  int e = (int)k;
  if (e < -1022) return s * deux_puissance(e + 600) * deux_puissance(-600);
  if (e > 1023) return s * deux_puissance(e - 600) * deux_puissance(600);
  return s * deux_puissance(e);
}
double log(double x) {
  if (x != x || x < 0) return __builtin_nan("");
  if (x == 0) return -__builtin_inf();
  if (x == __builtin_inf()) return x;
  int bias = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984.0; bias = -54; }   // sous-normal : × 2^54
  union { double d; uint64_t u; } v; v.d = x;
  int e = (int)((v.u >> 52) & 0x7ff) - 1023 + bias;
  v.u = (v.u & 0xfffffffffffffULL) | (1023ULL << 52);
  double m = v.d;
  if (m > 1.41421356237309504880) { m *= 0.5; ++e; }
  double z = (m - 1) / (m + 1), z2 = z * z, p = z, s = 0;
  for (int i = 1; i < 60; i += 2) { s += p / i; p *= z2; }
  return 2 * s + e * LN2;
}
double log2(double x) { return log(x) / LN2; }
double log10(double x) { return log(x) / 2.30258509299404568402; }
double pow(double x, double y) {
  if (y == 0) return 1;
  if (x == 0) return y > 0 ? 0 : __builtin_inf();
  if (x < 0) { double n = __builtin_floor(y); if (n != y) return __builtin_nan(""); double r = exp(y * log(-x)); return ((long long)n & 1) ? -r : r; }
  return exp(y * log(x));
}
double sin(double x) { int q; double y; reduire(x, &q, &y); switch (q) { case 0: return sin_reduit(y); case 1: return cos_reduit(y); case 2: return -sin_reduit(y); default: return -cos_reduit(y); } }
double cos(double x) { int q; double y; reduire(x, &q, &y); switch (q) { case 0: return cos_reduit(y); case 1: return -sin_reduit(y); case 2: return -cos_reduit(y); default: return sin_reduit(y); } }
double tan(double x) { return sin(x) / cos(x); }
double tanh(double x) { if (x > 20) return 1; if (x < -20) return -1; double e = exp(2 * x); return (e - 1) / (e + 1); }
double atan(double x) {
  if (x != x) return x;
  int neg = x < 0; if (neg) x = -x;
  int inv = x > 1; if (inv) x = 1 / x;
  // deux réductions : atan(x) = 2·atan(x / (1 + √(1 + x²)))
  double r = x / (1 + __builtin_sqrt(1 + x * x)); r = r / (1 + __builtin_sqrt(1 + r * r));
  double r2 = r * r, p = r, s = 0;
  for (int i = 1; i < 40; i += 2) { s += ((i >> 1) & 1 ? -p : p) / i; p *= r2; }
  s *= 4;
  if (inv) s = PI / 2 - s;
  return neg ? -s : s;
}
float sinf(float x) { return (float)sin(x); }
float cosf(float x) { return (float)cos(x); }
float tanf(float x) { return (float)tan(x); }
float expf(float x) { return (float)exp(x); }
float logf(float x) { return (float)log(x); }
float log2f(float x) { return (float)log2(x); }
float log10f(float x) { return (float)log10(x); }
float powf(float x, float y) { return (float)pow(x, y); }
float atanf(float x) { return (float)atan(x); }
float tanhf(float x) { return (float)tanh(x); }

void* memset(void* d, int c, size_t n) { unsigned char* p = (unsigned char*)d; while (n--) *p++ = (unsigned char)c; return d; }
void* memcpy(void* d, const void* s, size_t n) { unsigned char* p = (unsigned char*)d; const unsigned char* q = (const unsigned char*)s; while (n--) *p++ = *q++; return d; }
void* memmove(void* d, const void* s, size_t n) {
  unsigned char* p = (unsigned char*)d; const unsigned char* q = (const unsigned char*)s;
  if (p < q) { while (n--) *p++ = *q++; } else { p += n; q += n; while (n--) *--p = *--q; }
  return d;
}
// les fonctions virtuelles pures et les destructeurs virtuels des moteurs
void __cxa_pure_virtual() { __builtin_trap(); }
}
// les destructeurs virtuels appellent operator delete (jamais utilisé : tout est statique)
void operator delete(void*) noexcept { }
void operator delete(void*, size_t) noexcept { }
