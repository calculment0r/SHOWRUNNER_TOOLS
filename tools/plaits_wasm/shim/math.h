// SHOWRUNNER — <cmath> minimal (voir sr_math.cc) : les fonctions exactes
// (valeur absolue, racine, arrondis) sont des instructions WebAssembly ; les
// transcendantes sont écrites dans sr_math.cc.
#ifndef SR_SHIM_CMATH
#define SR_SHIM_CMATH
#include <stddef.h>
extern "C" {
float sinf(float); float cosf(float); float tanf(float); float expf(float); float logf(float);
float log2f(float); float log10f(float); float powf(float, float); float atanf(float); float tanhf(float);
double sin(double); double cos(double); double tan(double); double exp(double); double log(double);
double log2(double); double log10(double); double pow(double, double); double atan(double); double tanh(double);
}
static inline float fabsf(float x) { return __builtin_fabsf(x); }
static inline float sqrtf(float x) { return __builtin_sqrtf(x); }
static inline float floorf(float x) { return __builtin_floorf(x); }
static inline float ceilf(float x) { return __builtin_ceilf(x); }
static inline float truncf(float x) { return __builtin_truncf(x); }
static inline float roundf(float x) { return __builtin_truncf(x + (x < 0 ? -0.5f : 0.5f)); }
static inline float fmodf(float x, float y) { return x - __builtin_truncf(x / y) * y; }
static inline double fabs(double x) { return __builtin_fabs(x); }
static inline double sqrt(double x) { return __builtin_sqrt(x); }
static inline double floor(double x) { return __builtin_floor(x); }
static inline double ceil(double x) { return __builtin_ceil(x); }
static inline double fmod(double x, double y) { return x - __builtin_trunc(x / y) * y; }
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
namespace std {
using ::sinf; using ::cosf; using ::tanf; using ::expf; using ::logf; using ::log2f; using ::powf;
using ::sin; using ::cos; using ::tan; using ::exp; using ::log; using ::log2; using ::pow;
inline float abs(float x) { return __builtin_fabsf(x); }
inline float sqrt(float x) { return __builtin_sqrtf(x); }
inline float floor(float x) { return __builtin_floorf(x); }
inline float fabs(float x) { return __builtin_fabsf(x); }
}
#endif
