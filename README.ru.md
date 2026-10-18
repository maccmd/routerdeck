# RouterDeck

**RouterDeck Console** — оконный интерфейс управления OpenWrt по образцу
настольных утилит для роутеров, таких как MikroTik WinBox: списки объектов с
флагами и живыми счётчиками, окна объектов, изменения применяются сразу, есть
Undo/Redo и Safe Mode, а также командная строка в стиле RouterOS. Консоль
работает с rpcd через `/ubus` в uhttpd и меняет UCI через собственный плагин
rpcd. LuCI для неё не нужна, но может стоять рядом.

[English](README.md) · [RouterDeck Console](docs/console.md) · [План и статус](docs/console-plan.ru.md) · [Установка](docs/installation.md) · [Разработка](docs/development.md) · [Совместимость](docs/compatibility.md) · [Проверка](docs/testing.md)

![Список интерфейсов, правила firewall, окно правила и командная строка в RouterDeck Console](docs/screenshots/console-light.png)

Здесь описана текущая ветка `main`. Опубликованный предварительный выпуск
**v0.1.0** был прежней темой для LuCI (`luci-theme-routerdeck` с необязательной
панелью мониторинга и страницей Workspace). Эта тема удалена из исходников и
больше не развивается; как её снять с роутера — в
[инструкции по установке](docs/installation.md#removing-the-old-luci-theme).

## Возможности

- **Окна**: Quick Set, WiFi (со списком доступа), Interfaces (Ethernet, VLAN,
  bonding, туннели GRE/EoIP/IPIP/VXLAN, WireGuard, OpenVPN), Bridge, PPP
  (клиенты, PPPoE-сервер, secrets), IP (адреса, ARP, маршруты, firewall с
  mangle, raw и списками адресов, IPsec, DHCP-сервер, DNS, динамический DNS,
  пулы, службы, настройки, UPnP), IPv6, Routing (правила, таблицы, OSPF и BGP
  через bird), очереди (simple queues и SQM), Files, журнал и меню System
  (имя, часы, NTP, журналирование, пароль, пользователи, сертификаты, пакеты,
  планировщик, скрипты, автозапуск, ресурсы, светодиоды, диски, резервная
  копия и восстановление, прошивка, сброс, перезагрузка). Это живые списки
  объектов с флагами как в RouterOS, комментариями, поиском, сортировкой и
  контекстным меню.
- **Инструменты**: Ping, Traceroute, Torch, Bandwidth Test (iperf3), IP Scan,
  Netwatch и Graphing (службы на роутере), Wake on LAN и живые графики
  трафика.
- **Изменения применяются сразу**, каждое — один шаг Undo, без отдельного
  *Save & Apply*. **Safe Mode** откатывает всё, если консоль перестала
  отвечать — например, когда изменение отрезало вас от роутера.
- **New Terminal** — командная строка в стиле RouterOS над теми же объектами
  (`/ip firewall filter print`, `add`, `set`, `export`, Tab, `?`).
  **New Shell** — оболочка роутера через ttyd.

Соответствие окон и объектов OpenWrt, командная строка, механизм изменений,
права доступа и ограничения описаны в [описании консоли](docs/console.md).

## Совместимость

| Система | Формат | Проверка |
| --- | --- | --- |
| OpenWrt 25.12.5, armsr/armv8 | `.apk` | Установка, удаление и проверки консоли в QEMU |
| OpenWrt 24.10.8, armsr/armv8 | `.ipk` | Установка, удаление и проверки консоли в QEMU |
| FriendlyWrt / NanoPi R3S-LTS | Не подтверждена | Нужна проверка конкретной прошивки и устройства |

Что именно проверялось — в [отчёте](docs/testing.md). Проверки идут в
виртуальных машинах: настоящие драйверы Ethernet и Wi-Fi, PPPoE и VPN на
физическом устройстве ими не подтверждены.

## Установка

Готового выпуска консоли пока нет. Соберите пакет из исходников (см.
[Разработку](docs/development.md#checks-and-builds)), перенесите его в `/tmp`
роутера и установите:

```sh
# OpenWrt 25.12
apk add --allow-untrusted /tmp/routerdeck-console-0.1.0-r1.apk
# OpenWrt 24.10
opkg install /tmp/routerdeck-console_0.1.0-r1_all.ipk
```

Откройте `http://<роутер>/routerdeck/` и войдите под учётной записью роутера
(по умолчанию root). Какие пакеты включают дополнительные окна и как удалить
консоль — в [инструкции по установке](docs/installation.md).

## Локальная разработка

```sh
npm ci
npm run dev                 # http://127.0.0.1:5173/routerdeck/ — имитация роутера
npx playwright install chromium webkit
./scripts/test.sh
./scripts/package.sh 25.12.5
./scripts/package.sh 24.10.8
```

Preview работает с имитацией роутера (вход `root`, пароль `routerdeck`) и с
настоящим роутером не связывается. Настоящая интеграция проверяется отдельно в
[OpenWrt VM](docs/development.md#openwrt-vm). Доступ к VM открыт только на
`127.0.0.1`; сетевые настройки macOS менять не требуется.

Лицензия — [Apache-2.0](LICENSE). В сборку консоли входит Preact (MIT), см.
[NOTICE](NOTICE). Проект не связан с MikroTik и OpenWrt и не использует код
или графику MikroTik.
