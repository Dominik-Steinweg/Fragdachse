"""Player-derived organic biped with distinct pyro equipment and palette."""
from biped_enemy_parts import build as biped


def build(c,spec):
    return biped(c,spec,'pyro')
