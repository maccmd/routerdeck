include $(TOPDIR)/rules.mk

PKG_NAME:=routerdeck-console
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0 MIT
PKG_MAINTAINER:=RouterDeck contributors

include $(INCLUDE_DIR)/package.mk

define Package/routerdeck-console
  SECTION:=admin
  CATEGORY:=Administration
  TITLE:=RouterDeck Console windowed web management
  DEPENDS:=+rpcd +rpcd-mod-ucode +rpcd-mod-luci +ucode +ucode-mod-fs +ucode-mod-ubus +ucode-mod-uci +uhttpd +uhttpd-mod-ubus +firewall4
  PKGARCH:=all
  URL:=https://github.com/maccmd/routerdeck
endef

define Package/routerdeck-console/description
  Experimental windowed management interface served at /routerdeck/.
  It talks to rpcd over /ubus and does not require LuCI. The bundled
  Preact libraries are MIT-licensed; see /www/routerdeck/licenses.txt.
endef

define Build/Compile
endef

# The web bundle is built on the host by scripts/build-console.mjs.
define Package/routerdeck-console/install
	@test -f ./htdocs/routerdeck/index.html || { echo 'routerdeck-console: run npm run build:console first' >&2; exit 1; }
	$(INSTALL_DIR) $(1)/www
	$(CP) ./htdocs/* $(1)/www/
	$(CP) ./root/* $(1)/
endef

# rpcd loads ucode plugins only at startup.
define Package/routerdeck-console/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
exit 0
endef

define Package/routerdeck-console/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
exit 0
endef

$(eval $(call BuildPackage,routerdeck-console))
