# @spec CRM-074 (docs/BACKLOG.md) — tranches T2 et T3 : les cinq pièces jointes de démonstration — un PDF avec texte, un
#       PDF numérisé sans texte, une image PNG, un document Word, un classeur Excel
# @spec docs/SPEC-pieces-jointes.md §8 (seed, preuves) ; docs/SPEC-seed.md (section `CRM-074`)
#
# Bibliothèque standard seule, et sortie REPRODUCTIBLE : dates d'archive fixes, aucun horodatage, aucun hasard. Rejouer
# le script rend des fichiers identiques octet pour octet ; ils sont versionnés à côté de lui.
#
#   python3 supabase/seed/pieces-jointes/generer.py

from __future__ import annotations

import io
import struct
import zipfile
import zlib
from pathlib import Path

ICI = Path(__file__).resolve().parent
DATE_FIXE = (2026, 10, 31, 9, 0, 0)


def pdf(pages: list[list[str]]) -> bytes:
    """Un PDF en Helvetica (WinAnsi) ; une page sans ligne n'a aucun flux de contenu — le cas d'un document numérisé."""

    objets: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]  # l'objet 2 est écrit une fois les pages connues
    police = 3
    objets.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    enfants: list[int] = []
    for lignes in pages:
        if lignes:
            texte = b" 0 -16 Td ".join(
                b"(" + ligne.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").encode("cp1252") + b") Tj"
                for ligne in lignes
            )
            flux = b"BT /F1 12 Tf 72 740 Td " + texte + b" ET"
            objets.append(b"<< /Length %d >>\nstream\n" % len(flux) + flux + b"\nendstream")
            contenu = b" /Contents %d 0 R" % len(objets)
        else:
            contenu = b""
        objets.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 %d 0 R >> >>%s >>"
            % (police, contenu)
        )
        enfants.append(len(objets))
    objets[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % n for n in enfants), len(enfants))
    sortie = io.BytesIO()
    sortie.write(b"%PDF-1.4\n")
    positions = []
    for numero, corps in enumerate(objets, start=1):
        positions.append(sortie.tell())
        sortie.write(b"%d 0 obj\n" % numero + corps + b"\nendobj\n")
    xref = sortie.tell()
    sortie.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objets) + 1))
    for position in positions:
        sortie.write(b"%010d 00000 n \n" % position)
    sortie.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objets) + 1, xref))
    return sortie.getvalue()


def png(largeur: int, hauteur: int) -> bytes:
    """Une maquette de page d'accueil aux couleurs de la charte : bandeau bleu, trois cartes, un bouton vert."""

    bleu, vert, jaune, fond, gris = (0x23, 0x46, 0x8C), (0x23, 0x8C, 0x33), (0xD9, 0xCF, 0x4A), (0xF7, 0xF8, 0xFA), (0xDD, 0xE1, 0xE8)

    def couleur(x: int, y: int) -> tuple[int, int, int]:
        if y < hauteur // 6:
            return bleu
        if hauteur // 3 <= y < hauteur // 3 + hauteur // 10 and largeur // 10 <= x < largeur // 10 + largeur // 5:
            return vert
        carte = largeur // 4
        for i in range(3):
            gauche = largeur // 10 + i * (carte + largeur // 20)
            if gauche <= x < gauche + carte and hauteur // 2 <= y < hauteur // 2 + hauteur // 3:
                return jaune if y < hauteur // 2 + hauteur // 20 else gris
        return fond

    brut = b"".join(b"\x00" + bytes(c for x in range(largeur) for c in couleur(x, y)) for y in range(hauteur))

    def bloc(genre: bytes, donnees: bytes) -> bytes:
        return struct.pack(">I", len(donnees)) + genre + donnees + struct.pack(">I", zlib.crc32(genre + donnees) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + bloc(b"IHDR", struct.pack(">IIBBBBB", largeur, hauteur, 8, 2, 0, 0, 0))
        + bloc(b"IDAT", zlib.compress(brut, 9))
        + bloc(b"IEND", b"")
    )


def archive(fichiers: dict[str, str]) -> bytes:
    sortie = io.BytesIO()
    with zipfile.ZipFile(sortie, "w", zipfile.ZIP_DEFLATED) as zf:
        for nom, contenu in fichiers.items():
            info = zipfile.ZipInfo(nom, date_time=DATE_FIXE)
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, contenu.encode("utf-8"))
    return sortie.getvalue()


def docx(paragraphes: list[str]) -> bytes:
    corps = "".join(f'<w:p><w:r><w:t xml:space="preserve">{p}</w:t></w:r></w:p>' for p in paragraphes)
    return archive({
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/></Relationships>'
        ),
        "word/document.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body>{corps}</w:body></w:document>"
        ),
    })


def xlsx(lignes: list[list[str]]) -> bytes:
    def cellule(valeur: str) -> str:
        if valeur.replace(".", "", 1).isdigit():
            return f"<c><v>{valeur}</v></c>"
        return f'<c t="inlineStr"><is><t>{valeur}</t></is></c>'

    rangs = "".join(f'<row r="{i}">' + "".join(cellule(v) for v in ligne) + "</row>" for i, ligne in enumerate(lignes, 1))
    return archive({
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/></Relationships>'
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            'Target="worksheets/sheet1.xml"/></Relationships>'
        ),
        "xl/worksheets/sheet1.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f"<sheetData>{rangs}</sheetData></worksheet>"
        ),
    })


FICHIERS = {
    "devis-refonte-vertuo.pdf": pdf([[
        "Devis n° 2026-118 — Refonte du monitoring Vertuo",
        "Client : Vertuo SAS, 12 rue des Halles, Lyon",
        "Lot 1 — Audit des sondes existantes : 3 200 €",
        "Lot 2 — Tableaux de bord et alertes : 7 800 €",
        "Total hors taxes : 11 000 €. Validité : 30 jours.",
    ]]),
    "plan-signe-scanne.pdf": pdf([[]]),
    "maquette-accueil.png": png(480, 300),
    # `CRM-140` (docs/SPEC-seed.md §44) : le logo de signature du courrier HTML, cité par `cid:` dans son corps.
    "logo-sogexia.png": png(96, 32),
    "cahier-des-charges.docx": docx([
        "Cahier des charges — Refonte du monitoring",
        "Objectif : remplacer les alertes par courriel par un tableau de bord partagé.",
        "Périmètre : les quarante sondes du site de production et leurs seuils.",
        "Livraison attendue avant la fin du trimestre.",
    ]),
    "budget-previsionnel.xlsx": xlsx([
        ["Poste", "Montant"],
        ["Audit", "3200"],
        ["Tableaux de bord", "7800"],
        ["Total", "11000"],
    ]),
}


if __name__ == "__main__":
    for nom, contenu in FICHIERS.items():
        (ICI / nom).write_bytes(contenu)
        print(f"{nom} — {len(contenu)} octets")
