from __future__ import annotations

from collections import OrderedDict

_MAX_TRACKED = 5000

# (chat_id, message_id) -> owner tg_id
_owners: OrderedDict[tuple[int, int], int] = OrderedDict()

# callback-префиксы, доступные всем в группе
EXEMPT_PREFIXES = ("pvp:",)


def register_panel(chat_id: int, message_id: int, tg_id: int) -> None:
    key = (chat_id, message_id)
    _owners[key] = tg_id
    _owners.move_to_end(key)
    while len(_owners) > _MAX_TRACKED:
        _owners.popitem(last=False)


def claim_or_check(chat_id: int, message_id: int, tg_id: int) -> bool:
    """True — клик разрешён. Незанятую панель забирает первый кликнувший."""
    key = (chat_id, message_id)
    owner = _owners.get(key)
    if owner is None:
        register_panel(chat_id, message_id, tg_id)
        return True
    return owner == tg_id
