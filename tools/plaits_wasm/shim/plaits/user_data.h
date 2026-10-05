// SHOWRUNNER — remplace plaits/user_data.h (la mémoire flash du module) :
// aucune donnée de l'utilisateur, les moteurs prennent leurs données d'usine
// (les trois banques FM-6 de resources.cc), comme le fait la version TEST.
#ifndef PLAITS_USER_DATA_H_
#define PLAITS_USER_DATA_H_
#include "stmlib/stmlib.h"
namespace plaits {
class UserData {
 public:
  enum { ADDRESS = 0x08007000, SIZE = 0x1000 };
  UserData() { }
  inline const uint8_t* ptr(int slot) const { return NULL; }
};
}
#endif
