# RouterDeck Console: план WinBox-подобного интерфейса для OpenWrt

Статус на 2026-10-18: **этап 0 выполнен**, остальные этапы не начаты.

- Пакет `routerdeck-console` (ACL, ucode-плагин `routerdeck.info`, статика в
  `/www/routerdeck/`) собирается в SDK 25.12.5 и устанавливается на VM.
- Клиент `console/`: вход через `session login`, пакетные JSON-RPC запросы,
  форма входа поверх окон при истёкшей сессии, тулбар (Undo/Redo и Safe Mode пока
  неактивны), меню с подменю IP, MDI-окна (каскад, перетаскивание, изменение
  размера со всех сторон, сворачивание, разворачивание, клавиши F6, Esc/F4, Alt+T),
  восстановление окон после перезагрузки и повторного входа.
- Окна-списки показывают вкладки, тулбар и колонки, но данных роутера ещё нет.
- Проверено: юнит-тесты, e2e в preview с mock `/ubus` (Chromium, WebKit),
  `tests/vm/console.spec.mjs` на настоящем rpcd OpenWrt 25.12.5.
- На VM 25.12.5 подтвердилось: `ip-tiny` установлен (`ip -j` доступен), есть
  ubus-объекты `log` и `luci-rpc`, ttyd по умолчанию не установлен.

## Зачем

Тема `luci-theme-routerdeck` не может стать похожей на RouterOS. Каждое её окно —
это iframe со страницей LuCI: CBI-форма, Save & Apply, правило «одна форма за
раз». Меню взято из LuCI (Status/System/Network), а не устроено по подсистемам.
В LuCI нет списков объектов с флагами и счётчиками, нет мгновенного применения,
Safe Mode и Terminal.

Поэтому делаем отдельный интерфейс **RouterDeck Console**. Он работает напрямую с
rpcd через `/ubus` JSON-RPC и с UCI. LuCI для него не нужна, но может стоять рядом.

Решения, принятые с пользователем:

- клиент на **Preact + esbuild**, на роутер попадает только собранная статика;
- Terminal в v1 — **ash через ttyd**, CLI в стиле RouterOS — отдельным этапом позже;
- первые окна: **Interfaces, IP → Addresses, IP → Routes, IP → Firewall,
  IP → DHCP Server (Leases), Log**, плюс Safe Mode, Undo/Redo и Terminal.

Название и ресурсы — собственные. Слова WinBox/RouterOS не используем в имени
продукта, иконки и графику MikroTik не копируем: повторяем поведение, а не бренд.

## Что должно получиться (поведение WinBox)

- **Главное окно.**
  - Верхний тулбар: Undo, Redo, кнопка Safe Mode, `Session: <адрес>`; справа
    информационные поля (uptime, load, RAM).
  - Заголовок вкладки: `root@192.168.1.1 (OpenWrt) - RouterDeck <версия> on <модель> (<arch>)`.
- **Левое меню по подсистемам:** Interfaces, IP ▸ (Addresses, Routes, Firewall,
  DHCP Server), Log, New Terminal, Exit. Пункты с ▸ раскрываются выпадающим
  подменю. Отсутствующие возможности скрываются, а не показываются серыми.
- **MDI-область.**
  - Каждый пункт меню открывает окно; повторный клик выводит окно наверх.
  - Окна открываются каскадом на запомненном для их типа месте и перекрываются.
  - Никакого автотайлинга: «Tile/Cascade» только по явной команде.
  - Свернуть, развернуть в пределах области, закрыть. Свёрнутые окна — плашками
    внизу области. Ограничения в 6 окон нет.
- **Окно-список.**
  - Вкладки сверху, тулбар `+ − ✓ ✗ 🗨` (комментарий), фильтр и поле Find.
  - Колонка флагов: X — выключен, D — динамический, R — running, S — slave,
    A — active, C — connected, I — invalid. Колонка `#` там, где важен порядок.
  - Выключенные строки серые, комментарии — отдельной строкой `;;; текст` над объектом.
  - Сортировка по колонке, выбор колонок, мультивыбор Ctrl/Shift, контекстное меню.
  - Двойной клик открывает объект. Внизу строка состояния `N items (M selected)`
    или `N items out of M`.
  - Данные обновляются раз в секунду, выделение, фокус и прокрутка при этом сохраняются.
- **Окно объекта.**
  - Заголовок вида `Address <192.168.1.1/24>`, поля с вкладками.
  - Справа колонка кнопок OK / Cancel / Apply / Disable(Enable) / Comment / Copy /
    Remove, плюс свои для типа (Make Static, Reset Counters).
  - Внизу статус-бар (`enabled`, `running`, `dynamic` …).
  - Одновременно можно открыть сколько угодно окон объектов.
- **Мгновенное применение:** OK или Apply сразу коммитит и перезагружает нужный
  сервис. Никакого Save & Apply и никаких блокировок «другое окно не сохранено».
- **Safe Mode:** если клиент пропал, сделанные в Safe Mode изменения
  откатываются. Выход с сохранением или с отменой, лимит 100 действий — как в RouterOS.
- **Undo/Redo:** серверная история действий (до 100 записей).
- **Клавиши:**
  - Insert — добавить, Delete — удалить, Ctrl+E — включить, Ctrl+D — выключить;
  - Ctrl+M — комментарий, Ctrl+F — поиск, Enter — открыть объект;
  - Esc или F4 — закрыть окно, F6 — следующее окно, Alt+T — терминал.
- **Визуал:**
  - плотный: шрифт 12px, строки 20px, заголовок окна около 22px;
  - светлая серая «оконная» тема по умолчанию и тёмная (как WinBox 4);
  - никаких KPI-карточек и крупных заголовков.

## Архитектура

```
браузер (Preact SPA, /routerdeck/)
  │  POST /ubus  (JSON-RPC 2.0, пакетные запросы, sid из session login)
  ▼
uhttpd-mod-ubus → rpcd
  ├─ system / network.interface / network.device / luci-rpc   (чтение)
  ├─ uci get                                                  (чтение конфигов)
  └─ routerdeck (ucode-плагин)                                (запись, история,
        │                                                       Safe Mode, данные ядра)
        ├─ /etc/config/* через uci cursor + service event config.change
        ├─ ip -j route / nft --json / logread / /proc/net/nf_conntrack
        └─ /etc/init.d/routerdeck-safemode → сторож (отдельный процесс)
ttyd :7681 ← iframe окна Terminal
```

### Почему запись идёт через свой плагин, а не через `uci apply`

Факты из исходников rpcd (подтверждены по коду, на устройстве ещё не проверены):

- `uci apply` коммитит **все** отложенные изменения сессии во всех конфигах.
- Слот rollback у `uci apply` один на всю систему, таймаут фиксированный, продлить
  его нельзя. Пока rollback взведён, `commit` запрещён **всем** сессиям.
  `confirm` удаляет снимок. После `rpcd reload` ожидающий rollback теряется.
- `apply {rollback:false}`, вызванный во время чужого ожидающего rollback,
  молча снимает этот rollback и сам ничего не применяет.
- Отложенные изменения хранятся отдельно для каждой сессии, а `commit {config}`
  отправляет `config.change`, и procd перезагружает сервис примерно через 1 с.

Значит, `uci apply` не годится ни для мгновенного применения, ни для Safe Mode по
пропаже клиента. Поэтому каждое действие пользователя — один вызов
`routerdeck.apply`. Плагин:

1. проверяет, что конфиги из списка разрешённых (`network`, `firewall`, `dhcp`,
   `system`);
2. если в `/var/run/rpcd/snapshot-files/` есть файлы, значит LuCI ждёт подтверждения
   apply. Тогда возвращает «занято» и ничего не трогает;
3. сохраняет «до»-содержимое затронутых конфигов, применяет операции через
   `uci cursor`, коммитит и отправляет `service event config.change` по каждому конфигу;
4. после изменения firewall запускает `fw4 check`. При ошибке возвращает файлы
   «до», и пользователь видит сообщение (RouterOS тоже сразу отвергает неверное правило);
5. пишет запись истории `{id, time, user, description, configs, before, after}` в
   `/var/run/routerdeck/history.json` (не больше 100 записей и ограниченный объём);
6. если Safe Mode включён, увеличивает счётчик действий. На 101-м действии Safe Mode
   выключается без отката, как в RouterOS.

`undo` и `redo` возвращают «до» или «после» только когда текущий md5 файла
совпадает с ожидаемым. Иначе отвечают «конфигурация изменилась вне истории» и
ничего не делают.

### Safe Mode

- `routerdeck.safemode {action: enter|ping|exit, keep}`.
- **enter:**
  - снимок разрешённых конфигов в `/var/run/routerdeck/safemode/`, владелец =
    пользователь сессии, таймаут 60 с;
  - запуск procd-сервиса `routerdeck-safemode`;
  - если режим уже занят другой сессией — ошибка с именем владельца (перехват, как
    в RouterOS, — позже).
- **ping:** клиент шлёт раз в 5 с, обновляет heartbeat.
- **exit keep:** остановить сторож и удалить снимок.
- **exit undo:** вернуть снимок (только изменившиеся файлы) и отправить `config.change`.
- **Сторож** — отдельный ucode-скрипт `/usr/libexec/routerdeck/safemode-watchdog`
  со своим `uloop`:
  - раз в секунду проверяет heartbeat;
  - по таймауту возвращает файлы, шлёт `config.change`, пишет запись в syslog и
    удаляет состояние.
  - Он вынесен из rpcd намеренно: исключение в таймере внутри rpcd ломает весь цикл
    rpcd, перезапуск rpcd теряет состояние, а наличие uloop в плагинах 24.10 не
    подтверждено.
- Откатываются и изменения, сделанные за это время из LuCI. В RouterOS так же.
- **Клиент:**
  - кнопка Safe Mode подсвечена, пока режим включён;
  - после переподключения клиент спрашивает статус и показывает «изменения Safe
    Mode были откачены», если сработал сторож.

### Чтение данных

| Окно | Источник |
|---|---|
| Interfaces | `luci-rpc getNetworkDevices` (все `/sys/class/net`, счётчики u64) + `uci get network` (секции `device`) + `network.device status`; скорость считаем по разнице за секунду |
| Interfaces → Networks | `network.interface dump` + `uci get network` (секции `interface`) |
| IP → Addresses | `uci get network` (статические) + `network.interface dump` (фактические и динамические) |
| IP → Routes | `routerdeck.routes`: `ip -j -4 route show table all`, если нет — разбор текстового вывода; + секции `route` из UCI |
| Firewall → Filter/NAT | `uci get firewall` + `routerdeck.fw_counters` (`nft --terse --json list ruleset`, связь по `comment "!fw4: <name>"`) |
| Firewall → Connections | `routerdeck.conntrack` (`/proc/net/nf_conntrack`), без зависимости от luci-base |
| DHCP Server | `uci get dhcp` + `luci-rpc getDHCPLeases` |
| Log | `routerdeck.log {after}`: `log read {stream:false, oneshot:true}`, на 24.10 — `logread` |
| Шапка | `system board`, `system info` |

Один общий планировщик собирает запросы всех видимых окон в один пакетный
JSON-RPC запрос раз в секунду. Свёрнутые окна и скрытая вкладка не опрашиваются.
Сессия rpcd продлевается при каждом обращении. Если сервер ответил
`-32002 Access denied`, поверх окон появляется форма входа, а окна остаются на месте.

### ACL и зависимости

Файл `/usr/share/rpcd/acl.d/routerdeck-console.json`, группа `routerdeck-console`:

- **read:**
  - ubus: `system` [board, info], `network.interface` [dump],
    `network.device` [status], `luci-rpc` [getNetworkDevices, getDHCPLeases,
    getHostHints], `uci` [get, configs], `routerdeck` [info, history, routes,
    fw_counters, conntrack, log, terminal];
  - uci: `network`, `firewall`, `dhcp`, `system`, `ttyd`.
- **write:** `routerdeck` [apply, undo, redo, safemode].

У root по умолчанию `read '*'` и `write '*'`, поэтому группа выдаётся автоматически.
Плагин работает от root мимо uci-ACL rpcd, поэтому список разрешённых конфигов
жёстко задан в самом плагине.

`DEPENDS`: `+uhttpd +uhttpd-mod-ubus +rpcd +rpcd-mod-ucode +rpcd-mod-luci
+ucode-mod-fs +ucode-mod-uci +ucode-mod-ubus +ucode-mod-uloop +ucode-mod-log`.
`ttyd` — необязательная зависимость: без него окно Terminal подсказывает, как его
установить.

## Как объекты RouterOS ложатся на OpenWrt

| Окно RouterOS | Строки в OpenWrt | Флаги | Ограничения |
|---|---|---|---|
| **Interfaces** (вкладка Interface) | сетевые устройства: ether, bridge, vlan, wireguard, pppoe, lo | R (up и carrier), S (есть master/bridge), D (нет секции `device` в UCI) | Выключить устройство в UCI нельзя, кнопка Disable неактивна. Редактируются MTU и MAC через секцию `device` |
| Interfaces → **Networks** (только OpenWrt) | логические интерфейсы `network.interface` | R (up), X (`disabled 1`) | В RouterOS такого понятия нет, но без него OpenWrt не настроить: протокол, устройство, автозапуск |
| **IP → Addresses** | каждый `ipaddr` у сетей со статическим протоколом + адреса DHCP/PPP из dump | D (динамический, только чтение), I (настроен, но не поднят) | Отключить или прокомментировать отдельный адрес в UCI нельзя. При правке `option ipaddr`+`netmask` переводятся в `list ipaddr 'a.b.c.d/nn'` |
| **IP → Routes** | маршруты ядра + секции `route` | D, A (есть в ядре), C (proto kernel, scope link), S (из UCI), X (`disabled 1`) | Выпадающий фильтр по таблице маршрутизации, как в WinBox. IPv6 → Routes — тот же компонент, но отдельный этап |
| **Firewall → Filter Rules** | секции `rule` по порядку; chain определяется так: src+dest → forward, только src → input, только dest → output | X (`enabled 0`) | Порядок меняется перетаскиванием (`order`). Комментарий хранится в `name`. Счётчики сбрасываются при каждой перезагрузке fw4, при одинаковых `name` они неоднозначны и показываются как «—» |
| **Firewall → NAT** | `redirect` (dst-nat/src-nat), `nat`, masquerade зон | X; masq зоны — строка D, её переключатель меняет `masq` зоны | У masquerade в fw4 нет счётчика |
| **Firewall → Connections** | conntrack | — | Только чтение, виртуализированный список |
| Firewall → **Zones** (только OpenWrt) | `zone` + `forwarding` | X (`enabled 0`) | Без зон fw4 не настроить; forwarding редактируется в окне зоны |
| **IP → DHCP Server** (вкладки DHCP, Leases) | `dhcp`-секции по сетям; аренды = динамические + `host` | D, X (`enable 0` у `host`, `ignore 1` у сервера) | Кнопка Make Static создаёт `host` с mac/ip/name. Статус: bound / waiting. Аренды DHCPv6 — позже |
| **Log** | syslog | цвет по priority | Как в RouterOS, хранится 1000 строк; колонки Time, Topics (facility, priority, программа), Message |
| **New Terminal** | iframe на ttyd (`http(s)://<host>:7681`) | — | ttyd спрашивает логин ещё раз (`/bin/login`). Если UI открыт по https, а ttyd по http, будет mixed content — нужен `ssl` у ttyd |

Комментарии к объектам без своего поля храним в `option comment`. netifd игнорирует
неизвестные опции, а fw4 печатает предупреждение, поэтому для fw4 используем `name`.

## Структура кода

```
console/                      клиент (исходники)
  src/main.jsx
  src/api/rpc.js              JSON-RPC: login, пакеты, сессия, ошибки
  src/api/poller.js           общий опрос, пауза для скрытых окон
  src/api/routerdeck.js       обёртки методов плагина
  src/shell/                  Desktop, Toolbar, Menu (flyout), Login, Windows menu
  src/mdi/                    WorkArea, Window, geometry.js (drag/resize/каскад)
  src/list/                   ListWindow, Grid (виртуализация, флаги, сортировка,
                              колонки, мультивыбор), ListToolbar, ContextMenu, filter.js
  src/item/                   ItemWindow, поля (text, number, select, multi ▲▼,
                              отрицание «!», IP/CIDR с валидацией)
  src/model/                  дескрипторы окон: interfaces, networks, addresses,
                              routes, fw-filter, fw-nat, fw-zones, connections,
                              dhcp-servers, dhcp-leases, log, terminal
  src/lib/                    format (bytes, rate, uptime), ip, ops (сборка операций)
  styles/console.css          токены светлой и тёмной темы, плотная сетка
  mock/                       фикстуры UCI и ответов ubus, записанные с VM
routerdeck-console/           OpenWrt-пакет
  Makefile
  htdocs/routerdeck/          собранная статика (генерируется, в .gitignore)
  root/usr/share/rpcd/acl.d/routerdeck-console.json
  root/usr/share/rpcd/ucode/routerdeck
  root/usr/libexec/routerdeck/safemode-watchdog
  root/etc/init.d/routerdeck-safemode
scripts/build-console.mjs     esbuild → routerdeck-console/htdocs/routerdeck/
scripts/mock-ubus.mjs         mock /ubus для preview и e2e
```

Ядро — **дескриптор окна**. Он описывает колонки, флаги, `load()` (какие вызовы
нужны и как превратить ответы в строки), схему формы по вкладкам и функции,
которые строят операции add / set / remove / enable / disable / comment / move.
`ListWindow` и `ItemWindow` универсальны и работают с любым дескриптором. Так все
окна ведут себя одинаково, как в RouterOS, а позже на тех же дескрипторах можно
построить CLI вида `/ip address print`.

### Что переиспользуем

- Шаблон Makefile на `package.mk` из `luci-app-routerdeck/Makefile`: пустой
  `Build/Compile`, `PKGARCH:=all`, `postinst` с `rpcd reload`.
- Логику drag/resize: pointer capture, отмена по Esc, клавиатурное перемещение, щит
  для iframe. Источник — `luci-theme-routerdeck/htdocs/luci-static/routerdeck/windows.js:465-528`
  и `windows.css:31-32`. Переносим как ESM-модуль `mdi/geometry.js`: сам файл
  `windows.js` завязан на LuCI и iframe.
- Форматирование `RD.bytes`, `RD.rate`, `RD.uptime` из `core.js:86-99` → `lib/format.js`.
- Обновление строк таблицы без потери фокуса и прокрутки — идея `dashboard.js:87-120`.
  В Preact это даёт `key` по идентификатору объекта.
- Инфраструктуру VM и тестов: `scripts/vm.py`, `scripts/vm-ssh.sh`,
  `playwright.vm.config.mjs`, вход через пароль из `.cache/vm/password`, проверку
  через SSH (`uci get`, `ip route`, `nft list`).

### Что поменять в существующих скриптах ради 4-го пакета

- `scripts/sdk-build.sh`: цикл копирования пакетов, проверка `.config` (иначе в
  закэшированном SDK пакет молча не соберётся), clean/compile.
- `scripts/package.sh`: перед docker-сборкой запускать `npm run build:console`.
- `scripts/check.mjs`: добавить каталоги.
- `scripts/vm.py:119-120` и `tests/lifecycle/packages.spec.mjs:38,47`: сейчас там
  жёстко ожидается ровно 3 пакета.
- `scripts/preview.mjs`: маршрут `/routerdeck/` и `POST /ubus` на mock.
- `package.json`: скрипты `build:console`, `dev:console`; devDependencies `preact`,
  `@preact/signals`, `esbuild` с точными версиями.
- Документация: README и README.ru, `docs/installation.md`, `docs/development.md`,
  `docs/architecture.md`, `docs/compatibility.md`.

## Этапы

Каждый этап заканчивается рабочим состоянием, которое можно проверить в preview и на VM.

### Этап 0. Каркас

- Пакет `routerdeck-console`, сборка esbuild, mock `/ubus`, клиент `rpc.js` с
  входом и пакетными запросами.
- Главное окно: тулбар, меню с подменю, MDI-область. Окна открываются каскадом,
  перетаскиваются, меняют размер, сворачиваются и разворачиваются; геометрия
  запоминается по типу окна.
- Плагин `routerdeck.info` (что доступно: `log read`, `ip -j`, ttyd, nft).
- **Готово, когда** вход работает в preview и на VM 25.12, пустые окна открываются
  из меню и ведут себя как MDI в WinBox.

### Этап 1. Списки только для чтения, живые данные

- `Grid`, `ListWindow`, `ItemWindow` (пока только просмотр), общий опрос.
- Окна: Interfaces (+Networks), IP → Addresses, IP → Routes, Firewall (Filter, NAT,
  Connections, Zones со счётчиками), DHCP Server (DHCP, Leases), Log.
- Плагин: `routes`, `fw_counters`, `conntrack`, `log`.
- **Готово, когда** все окна показывают данные VM, Tx/Rx и счётчики обновляются
  раз в секунду, Find, сортировка, выбор колонок и статус-бар работают.

### Этап 2. Запись и Undo/Redo

- Плагин: `apply`, `history`, `undo`, `redo`, проверка ожидающего apply от LuCI,
  `fw4 check`.
- В списках `+ − ✓ ✗ 🗨`, в окнах объектов OK / Apply / Cancel / Disable /
  Comment / Copy / Remove.
- По окнам: Addresses, статические маршруты, Filter и NAT (с перетаскиванием
  порядка), Zones, DHCP-серверы, статические аренды (Make Static), Networks
  (протокол, устройство, disabled).
- Конфликты: если объект изменился с момента открытия окна, предупреждаем в
  статус-баре, а Apply сначала перечитывает объект.
- **Готово, когда** каждое действие сразу видно в `uci show`, `ip route` и
  `nft list ruleset` на VM, а Undo/Redo возвращают md5 конфигов к ожидаемым.

### Этап 3. Safe Mode, Terminal, клавиатура, тёмная тема

- Сторож, procd-сервис, `routerdeck.safemode`, индикация на клиенте, лимит 100 действий.
- Окно Terminal (ttyd) с подсказкой, если ttyd не установлен.
- Горячие клавиши WinBox, тёмная тема, контекстные меню, меню Windows с
  Tile/Cascade по команде.
- **Готово, когда** включён Safe Mode, сделана правка, вкладка закрыта — и через
  60 с конфиг на VM восстановлен, сервис перезагружен, в syslog есть запись.

### Этап 4. Проверка и выпуск

- VM 25.12 (основная) и 24.10: установка, удаление, повторная установка, работа
  рядом с LuCI.
- Обновление CI, lifecycle-тестов, документации и скриншотов.

После этапа 1 окна независимы друг от друга: дескрипторы Interfaces/Addresses,
Routes, Firewall и DHCP/Log можно делать параллельно, каждый в своей ветке. Общие
компоненты (`Grid`, `ListWindow`, `ItemWindow`, `rpc.js`) к этому моменту должны
быть готовы.

## Проверка

- **Юнит-тесты** (`node --test`):
  - превращение фикстур с VM в строки и флаги для каждого дескриптора;
  - сборка операций: перевод `ipaddr`/`netmask` в `list`, chain правил, строки
    masquerade, Make Static;
  - сопоставление счётчиков `nft --json` по комментариям, включая повторяющиеся имена;
  - слияние маршрутов ядра и UCI;
  - пакетирование запросов и истечение сессии в `rpc.js`;
  - фильтр и сортировка в `Grid`.
- **E2E** (Playwright, preview + mock `/ubus`, Chromium и WebKit, ширина 1280–1920):
  - вход, меню и подменю, каскад без автотайлинга;
  - drag, resize, сворачивание;
  - добавить, изменить, выключить и удалить объект в каждом окне, перетаскивание
    правил, Make Static;
  - Undo/Redo, Safe Mode с ping, горячие клавиши;
  - живые обновления сохраняют выделение и прокрутку.
- **VM** (`playwright.vm.config.mjs`, проверка через SSH):
  - каждое действие отражается в `uci show`, `ip route`, `nft list ruleset`;
  - md5 после Undo совпадает с исходным;
  - Safe Mode откатывает изменения после закрытия вкладки;
  - если LuCI ждёт подтверждения apply, `routerdeck.apply` отвечает «занято»;
  - окно Terminal открывает ttyd (ttyd ставится в VM через WAN).
- **Ручная проверка:** сменить IP LAN в Safe Mode и убедиться, что через 60 с
  доступ вернулся по старому адресу.

## Риски и что проверить в первую очередь

- `ip -j` есть только с ip-full или ip-tiny. Есть ли он в стандартных образах
  25.12 и 24.10, проверить на VM; если нет — нужен текстовый разбор.
- Поведение rpcd выведено из кода, на устройстве не проверялось. На VM проверить:
  блокировку `commit` при ожидающем rollback, «тихое» снятие rollback через
  `apply(false)`, потерю rollback при `rpcd reload`.
- Сброс счётчиков fw4 при перезагрузке и неоднозначные `name`. Это отличие от
  RouterOS: честно показываем «—».
- Ответ на запрос плагина должен уложиться в таймаут rpcd (30 с). `fw4 check` и
  `nft --json` на больших наборах правил стоит замерить.
- ttyd: повторный вход, порт 7681, mixed content при https, нет SSO с сессией rpcd.
- Доступ к плагину открыт только группе `routerdeck-console`, и плагин сам
  ограничивает список конфигов. Перед выпуском нужен отдельный security review.
