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
  DEPENDS:=+rpcd +rpcd-mod-ucode +rpcd-mod-luci +rpcd-mod-iwinfo +ucode +ucode-mod-fs +ucode-mod-ubus +ucode-mod-uci +uhttpd +uhttpd-mod-ubus +firewall4
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
	$(INSTALL_BIN) ./root/etc/init.d/routerdeck-safemode $(1)/etc/init.d/routerdeck-safemode
	$(INSTALL_BIN) ./root/usr/libexec/routerdeck/safemode-watchdog $(1)/usr/libexec/routerdeck/safemode-watchdog
	$(INSTALL_BIN) ./root/usr/libexec/routerdeck/diag $(1)/usr/libexec/routerdeck/diag
	$(INSTALL_BIN) ./root/etc/init.d/routerdeck-netwatch $(1)/etc/init.d/routerdeck-netwatch
	$(INSTALL_BIN) ./root/usr/libexec/routerdeck/netwatch $(1)/usr/libexec/routerdeck/netwatch
	$(INSTALL_BIN) ./root/usr/libexec/routerdeck/run-script $(1)/usr/libexec/routerdeck/run-script
	$(INSTALL_BIN) ./root/usr/libexec/routerdeck/queues $(1)/usr/libexec/routerdeck/queues
	$(INSTALL_BIN) ./root/etc/init.d/routerdeck-graphing $(1)/etc/init.d/routerdeck-graphing
	$(INSTALL_BIN) ./root/usr/libexec/routerdeck/graphing $(1)/usr/libexec/routerdeck/graphing
	$(INSTALL_BIN) ./root/etc/hotplug.d/iface/90-routerdeck-queues $(1)/etc/hotplug.d/iface/90-routerdeck-queues
endef

define Package/routerdeck-console/conffiles
/etc/config/routerdeck
endef

# rpcd loads ucode plugins only at startup.
define Package/routerdeck-console/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
exit 0
endef

# The default prerm stops the Safe Mode watchdog; drop its runtime state and
# the Simple Queues set up on devices too.
define Package/routerdeck-console/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	if [ -f /var/run/routerdeck/queues.devices ]; then
		while read -r device ifb; do
			tc qdisc del dev "$$device" root 2>/dev/null
			tc qdisc del dev "$$device" ingress 2>/dev/null
			ip link del "$$ifb" 2>/dev/null
		done < /var/run/routerdeck/queues.devices
	fi
	rm -rf /var/run/routerdeck
	/etc/init.d/rpcd reload
}
exit 0
endef

$(eval $(call BuildPackage,routerdeck-console))
