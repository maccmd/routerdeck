include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-routerdeck-workspace
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=RouterDeck contributors

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-routerdeck-workspace
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=RouterDeck legacy workspace URL compatibility
  DEPENDS:=+luci-theme-routerdeck +luci-mod-status
  PKGARCH:=all
  URL:=https://github.com/maccmd/routerdeck
endef

define Build/Compile
endef

define Package/luci-app-routerdeck-workspace/install
	$(INSTALL_DIR) $(1)/www
	$(CP) ./htdocs/* $(1)/www/
	$(CP) ./root/* $(1)/
endef

define Package/luci-app-routerdeck-workspace/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache
}
exit 0
endef

define Package/luci-app-routerdeck-workspace/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-routerdeck-workspace))
