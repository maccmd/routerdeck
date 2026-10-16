include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-routerdeck
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=RouterDeck contributors

include $(INCLUDE_DIR)/package.mk

define Package/luci-theme-routerdeck
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=4. Themes
  TITLE:=RouterDeck compact dark and light theme
  DEPENDS:=+luci-base +luci-theme-bootstrap
  PKGARCH:=all
  URL:=https://github.com/maccmd/routerdeck
endef

define Build/Compile
endef

define Package/luci-theme-routerdeck/install
	$(INSTALL_DIR) $(1)/www $(1)/usr/share/ucode/luci
	$(CP) ./htdocs/* $(1)/www/
	$(CP) ./ucode/* $(1)/usr/share/ucode/luci/
	$(CP) ./root/* $(1)/
	chmod 755 $(1)/etc/uci-defaults/90-routerdeck
endef

define Package/luci-theme-routerdeck/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	if [ -f /etc/uci-defaults/90-routerdeck ]; then
		( . /etc/uci-defaults/90-routerdeck ) && rm -f /etc/uci-defaults/90-routerdeck
	fi
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache
}
exit 0
endef

define Package/luci-theme-routerdeck/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || [ "$${PKG_UPGRADE}" = 1 ] || {
	if [ "$$(uci -q get luci.main.mediaurlbase)" = /luci-static/routerdeck ]; then
		uci set luci.main.mediaurlbase=/luci-static/bootstrap
	fi
	uci -q delete luci.themes.RouterDeck
	uci commit luci
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache
}
exit 0
endef

$(eval $(call BuildPackage,luci-theme-routerdeck))
