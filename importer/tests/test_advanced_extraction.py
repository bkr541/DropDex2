"""Tests for advanced Device Library Plus extraction and the writer layer."""

from __future__ import annotations

import types
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, call, patch

import pytest

from dropdex_importer.models import (
    NormalizedAnalysisManifestEntry,
    NormalizedCue,
    NormalizedRecommendationEdge,
    NormalizedTrack,
    ParsedLibrary,
    NormalizedPlaylist,
    NormalizedPlacement,
    AnalysisFileSpec,
)
from dropdex_importer.parser import (
    _derive_anlz_siblings,
    _extract_colors,
    _extract_cues,
    _extract_recommendations,
    _extract_analysis_manifest,
    normalize_analysis_path,
    normalize_audio_path,
    _extract_tracks,
)
from dropdex_importer.supabase_writer import (
    ImportWriteResult,
    _finalize_import,
    _insert_cues,
    _insert_recommendation_edges,
    _insert_tracks,
)
from dropdex_importer.validation import validate


# ── Path normalization ────────────────────────────────────────────────────────


class TestNormalizeAnalysisPath:
    def test_forward_slashes_unchanged(self):
        assert normalize_analysis_path("/PIONEER/USBANLZ/abc.DAT") == "/PIONEER/USBANLZ/abc.DAT"

    def test_backslashes_converted(self):
        result = normalize_analysis_path("\\PIONEER\\USBANLZ\\abc.DAT")
        assert result == "/PIONEER/USBANLZ/abc.DAT"

    def test_windows_drive_letter_stripped(self):
        result = normalize_analysis_path("C:\\PIONEER\\USBANLZ\\abc.DAT")
        assert result == "/PIONEER/USBANLZ/abc.DAT"

    def test_drive_letter_with_leading_slash(self):
        result = normalize_analysis_path("/D:/PIONEER/USBANLZ/abc.DAT")
        assert result == "/PIONEER/USBANLZ/abc.DAT"

    def test_duplicate_slashes_collapsed(self):
        result = normalize_analysis_path("//PIONEER//USBANLZ//abc.DAT")
        assert result == "/PIONEER/USBANLZ/abc.DAT"

    def test_missing_leading_slash_added(self):
        result = normalize_analysis_path("PIONEER/USBANLZ/abc.DAT")
        assert result == "/PIONEER/USBANLZ/abc.DAT"

    def test_traversal_rejected(self):
        assert normalize_analysis_path("/PIONEER/../etc/passwd") is None

    def test_traversal_in_windows_path_rejected(self):
        assert normalize_analysis_path("C:\\PIONEER\\..\\etc\\passwd") is None

    def test_empty_string_returns_none(self):
        assert normalize_analysis_path("") is None

    def test_whitespace_only_returns_none(self):
        assert normalize_analysis_path("   ") is None

    def test_lowercase_drive_letter_stripped(self):
        result = normalize_analysis_path("c:/PIONEER/USBANLZ/abc.DAT")
        assert result == "/PIONEER/USBANLZ/abc.DAT"

class TestNormalizeAudioPath:
    def test_windows_path_preserves_volume_and_relative_identity(self):
        normalized, volume = normalize_audio_path(r"E:\\Contents\\Artist\\Track.FLAC")
        assert normalized == "/Contents/Artist/Track.FLAC"
        assert volume == "E:"

    def test_macos_volume_path_preserves_volume(self):
        normalized, volume = normalize_audio_path("/Volumes/DJ USB/Contents/Track.mp3")
        assert normalized == "/Contents/Track.mp3"
        assert volume == "DJ USB"

    def test_linux_media_path_preserves_volume(self):
        normalized, volume = normalize_audio_path("/media/kody/DROPDEX/Contents/Track.wav")
        assert normalized == "/Contents/Track.wav"
        assert volume == "DROPDEX"

    def test_traversal_is_rejected(self):
        assert normalize_audio_path("/Volumes/DJ USB/Contents/../secret.mp3")[0] is None


class TestTrackMetadataFidelity:
    def test_extracts_exact_duration_paths_and_raw_file_metadata(self):
        from datetime import datetime, timezone
        from types import SimpleNamespace

        content = SimpleNamespace(
            content_id=42,
            title=None,
            titleForSearch=None,
            subtitle="Extended Mix",
            artist_name="Artist",
            remixer_name="Remixer",
            original_artist_name="Original Artist",
            composer_name="Composer",
            lyricist_name="Lyricist",
            album_name="Album",
            genre_name="Genre",
            label_name="Label",
            color=SimpleNamespace(name="Purple"),
            image_path="/PIONEER/ART/cover.jpg",
            key=SimpleNamespace(name="8A"),
            bpmx100=14225,
            length=183456,
            djComment="Comment",
            path=r"E:\\Contents\\Artist\\Track.flac",
            fileName="Track.flac",
            fileType=99,
            fileSize=12345678,
            bitrate=1411,
            bitDepth=24,
            samplingRate=48000,
            isrc="USABC1234567",
            isHotCueAutoLoadOn=1,
            dateAdded=datetime(2026, 7, 14, tzinfo=timezone.utc),
            releaseDate=datetime(2026, 6, 1, tzinfo=timezone.utc),
            releaseYear=2026,
            trackNo=3,
            discNo=2,
            rating=5,
            masterDbId=10,
            masterContentId=20,
            analysisDataFilePath="/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            analysedBits=16,
            cueUpdateCount=2,
            analysisDataUpdateCount=3,
            informationUpdateCount=4,
            to_dict=lambda: {
                "content_id": 42,
                "title": None,
                "length": 183456,
                "releaseDate": datetime(2026, 6, 1, tzinfo=timezone.utc),
                "fileType": 99,
            },
        )
        db = MagicMock()
        db.get_content.return_value.all.return_value = [content]
        library = ParsedLibrary()

        _extract_tracks(db, library)

        track = library.tracks[0]
        assert track.title == "(untitled)"
        assert track.source_title is None
        assert track.duration_ms == 183456
        assert track.duration_seconds == 183
        assert track.file_path_normalized == "/Contents/Artist/Track.flac"
        assert track.file_path_volume == "E:"
        assert track.file_path_casefold == "/contents/artist/track.flac"
        assert track.file_type_code == 99
        assert track.file_format is None
        assert track.file_extension == "FLAC"
        assert track.file_size_bytes == 12345678
        assert track.bitrate_kbps == 1411
        assert track.bit_depth == 24
        assert track.sample_rate_hz == 48000
        assert track.original_artist == "Original Artist"
        assert track.composer == "Composer"
        assert track.lyricist == "Lyricist"
        assert track.source_metadata["releaseDate"] == "2026-06-01T00:00:00+00:00"
        assert track.rating == 5

    @pytest.mark.parametrize("raw_rating", ["", "not-a-number", None])
    def test_invalid_rating_syntax_is_stored_as_null(self, raw_rating):
        content = types.SimpleNamespace(
            content_id=42,
            title="Track",
            artist_name=None,
            remixer_name=None,
            album_name=None,
            genre_name=None,
            label_name=None,
            color=None,
            key=None,
            bpmx100=0,
            length=1000,
            rating=raw_rating,
            djComment=None,
            path=None,
            fileType=None,
            dateAdded=None,
            masterDbId=None,
            masterContentId=None,
            analysisDataFilePath=None,
            analysedBits=None,
            cueUpdateCount=None,
            analysisDataUpdateCount=None,
            informationUpdateCount=None,
            to_dict=lambda: {"content_id": 42, "rating": raw_rating},
        )
        db = MagicMock()
        db.get_content.return_value.all.return_value = [content]
        library = ParsedLibrary()

        _extract_tracks(db, library)

        assert library.tracks[0].rating is None

    def test_out_of_range_rating_is_dropped_with_warning(self):
        content = types.SimpleNamespace(
            content_id=42,
            title="Track",
            artist_name=None,
            remixer_name=None,
            album_name=None,
            genre_name=None,
            label_name=None,
            color=None,
            key=None,
            bpmx100=0,
            length=1000,
            rating=9,
            djComment=None,
            path=None,
            fileType=None,
            dateAdded=None,
            masterDbId=None,
            masterContentId=None,
            analysisDataFilePath=None,
            analysedBits=None,
            cueUpdateCount=None,
            analysisDataUpdateCount=None,
            informationUpdateCount=None,
            to_dict=lambda: {"content_id": 42, "rating": 9},
        )
        db = MagicMock()
        db.get_content.return_value.all.return_value = [content]
        library = ParsedLibrary()

        _extract_tracks(db, library)

        assert library.tracks[0].rating is None
        assert any("outside 0-5" in warning for warning in library.parse_warnings)


class TestDeriveAnlzSiblings:
    def test_dat_input_produces_three_paths(self):
        dat, ext, two_ex = _derive_anlz_siblings("/PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert dat == "/PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        assert ext == "/PIONEER/USBANLZ/P001/ANLZ0000.EXT"
        assert two_ex == "/PIONEER/USBANLZ/P001/ANLZ0000.2EX"

    def test_ext_input_corrects_to_dat(self):
        dat, ext, two_ex = _derive_anlz_siblings("/PIONEER/USBANLZ/P001/ANLZ0000.EXT")
        assert dat == "/PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        assert ext == "/PIONEER/USBANLZ/P001/ANLZ0000.EXT"
        assert two_ex == "/PIONEER/USBANLZ/P001/ANLZ0000.2EX"

    def test_2ex_input_corrects_to_dat(self):
        dat, ext, _ = _derive_anlz_siblings("/PIONEER/USBANLZ/P001/ANLZ0000.2EX")
        assert dat == "/PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        assert ext == "/PIONEER/USBANLZ/P001/ANLZ0000.EXT"

    def test_no_extension_treated_as_stem(self):
        dat, ext, two_ex = _derive_anlz_siblings("/PIONEER/USBANLZ/P001/ANLZ0000")
        assert dat == "/PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        assert ext == "/PIONEER/USBANLZ/P001/ANLZ0000.EXT"
        assert two_ex == "/PIONEER/USBANLZ/P001/ANLZ0000.2EX"

    def test_backslash_paths_normalized_in_siblings(self):
        dat, ext, two_ex = _derive_anlz_siblings("\\PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT")
        assert dat == "/PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        assert ext == "/PIONEER/USBANLZ/P001/ANLZ0000.EXT"
        assert two_ex == "/PIONEER/USBANLZ/P001/ANLZ0000.2EX"


# ── Analysis manifest ──────────────────────────────────────────────────────────


class TestExtractAnalysisManifest:
    def _make_library_with_track(self, analysis_path: Optional[str]) -> ParsedLibrary:
        lib = ParsedLibrary()
        lib.tracks.append(
            NormalizedTrack(
                rekordbox_content_id="42",
                title="Test Track",
                artist="Artist",
                album=None,
                remixer=None,
                genre=None,
                label=None,
                musical_key=None,
                bpm=128.0,
                duration_seconds=240,
                rating=None,
                comments=None,
                file_path="/music/track.mp3",
                file_format="MP3",
                date_added=None,
                analysis_data_file_path=analysis_path,
            )
        )
        return lib

    def test_track_with_analysis_path_produces_manifest_entry(self):
        lib = self._make_library_with_track("/PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        _extract_analysis_manifest(lib)
        assert len(lib.analysis_manifest) == 1
        entry = lib.analysis_manifest[0]
        assert entry.rekordbox_content_id == "42"
        assert len(entry.files) == 3
        asset_types = [f.asset_type for f in entry.files]
        assert asset_types == ["DAT", "EXT", "2EX"]
        dat_file = entry.files[0]
        assert dat_file.is_required is True
        assert entry.files[1].is_required is False

    def test_track_without_analysis_path_excluded_from_manifest(self):
        lib = self._make_library_with_track(None)
        _extract_analysis_manifest(lib)
        assert len(lib.analysis_manifest) == 0

    def test_traversal_path_rejected_with_warning(self):
        lib = self._make_library_with_track("/PIONEER/../etc/passwd")
        _extract_analysis_manifest(lib)
        assert len(lib.analysis_manifest) == 0
        assert any("rejected" in w for w in lib.parse_warnings)

    def test_normalized_path_strips_drive_letter(self):
        lib = self._make_library_with_track("C:\\PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT")
        _extract_analysis_manifest(lib)
        assert len(lib.analysis_manifest) == 1
        entry = lib.analysis_manifest[0]
        assert entry.normalized_analysis_path == "/PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        assert entry.original_analysis_path == "C:\\PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT"


# ── Color extraction ──────────────────────────────────────────────────────────


def _make_color_row(color_id: int, name: str):
    row = MagicMock()
    row.color_id = color_id
    row.name = name
    return row


class TestExtractColors:
    def test_returns_id_to_name_dict(self):
        db = MagicMock()
        db.get_color.return_value.all.return_value = [
            _make_color_row(1, "Red"),
            _make_color_row(2, "Blue"),
        ]
        lib = ParsedLibrary()
        result = _extract_colors(db, lib)
        assert result == {1: "Red", 2: "Blue"}
        assert lib.parse_warnings == []

    def test_exception_returns_empty_dict_with_warning(self):
        db = MagicMock()
        db.get_color.side_effect = Exception("no such table: djmdColor")
        lib = ParsedLibrary()
        result = _extract_colors(db, lib)
        assert result == {}
        assert len(lib.parse_warnings) == 1
        assert "Color table" in lib.parse_warnings[0]


# ── Cue extraction ────────────────────────────────────────────────────────────


def _make_cue_row(
    cue_id: int = 1,
    content_id: int = 42,
    kind: int = 0,
    color_table_index: Optional[int] = None,
    cue_comment: Optional[str] = None,
    is_active_loop: Optional[int] = None,
    beat_loop_numerator: Optional[int] = None,
    beat_loop_denominator: Optional[int] = None,
    in_usec: Optional[int] = None,
    out_usec: Optional[int] = None,
):
    row = MagicMock()
    row.cue_id = cue_id
    row.content_id = content_id
    row.kind = kind
    row.colorTableIndex = color_table_index
    row.cueComment = cue_comment
    row.isActiveLoop = is_active_loop
    row.beatLoopNumerator = beat_loop_numerator
    row.beatLoopDenominator = beat_loop_denominator
    row.inUsec = in_usec
    row.outUsec = out_usec
    row.in150FramePerSec = None
    row.out150FramePerSec = None
    row.inMpegFrameNumber = None
    row.outMpegFrameNumber = None
    row.inMpegAbs = None
    row.outMpegAbs = None
    row.inDecodingStartFramePosition = None
    row.outDecodingStartFramePosition = None
    row.inFileOffsetInBlock = None
    row.outFileOffsetInBlock = None
    row.inNumberOfSampleInBlock = None
    row.outNumberOfSampleInBlock = None
    return row


class TestExtractCues:
    def _db_with_cues(self, cue_rows: list):
        db = MagicMock()
        db.get_cue.return_value.all.return_value = cue_rows
        return db

    def test_memory_cue_when_no_color_index(self):
        db = self._db_with_cues([_make_cue_row(cue_id=1, color_table_index=None)])
        lib = ParsedLibrary()
        _extract_cues(db, lib, {})
        assert lib.cues[0].cue_family == "memory"

    def test_memory_cue_when_color_index_zero(self):
        db = self._db_with_cues([_make_cue_row(cue_id=1, color_table_index=0)])
        lib = ParsedLibrary()
        _extract_cues(db, lib, {})
        assert lib.cues[0].cue_family == "memory"

    def test_hot_cue_when_positive_color_index(self):
        db = self._db_with_cues([_make_cue_row(cue_id=1, color_table_index=3)])
        lib = ParsedLibrary()
        _extract_cues(db, lib, {3: "Pink"})
        cue = lib.cues[0]
        assert cue.cue_family == "hot"
        assert cue.color_name == "Pink"

    def test_hot_cue_slot_is_none(self):
        """hot_cue_slot cannot be determined from DB; must remain None."""
        db = self._db_with_cues([_make_cue_row(cue_id=1, color_table_index=2)])
        lib = ParsedLibrary()
        _extract_cues(db, lib, {})
        assert lib.cues[0].hot_cue_slot is None

    def test_point_type_loop_when_kind_4(self):
        db = self._db_with_cues([_make_cue_row(cue_id=1, kind=4)])
        lib = ParsedLibrary()
        _extract_cues(db, lib, {})
        assert lib.cues[0].point_type == "loop"

    def test_point_type_cue_when_kind_not_4(self):
        for kind in (0, 3):
            db = self._db_with_cues([_make_cue_row(cue_id=1, kind=kind)])
            lib = ParsedLibrary()
            _extract_cues(db, lib, {})
            assert lib.cues[0].point_type == "cue", f"Expected 'cue' for kind={kind}"

    def test_dedupe_key_prefixed_with_db(self):
        db = self._db_with_cues([_make_cue_row(cue_id=99)])
        lib = ParsedLibrary()
        _extract_cues(db, lib, {})
        assert lib.cues[0].dedupe_key == "db:99"

    def test_loop_with_null_out_usec(self):
        """Loops may have None out_usec; this must not raise."""
        row = _make_cue_row(cue_id=1, kind=4, in_usec=5000000, out_usec=None)
        db = self._db_with_cues([row])
        lib = ParsedLibrary()
        _extract_cues(db, lib, {})
        cue = lib.cues[0]
        assert cue.in_usec == 5000000
        assert cue.out_usec is None

    def test_missing_cue_table_produces_warning_not_error(self):
        db = MagicMock()
        db.get_cue.side_effect = Exception("no such table: djmdCue")
        lib = ParsedLibrary()
        _extract_cues(db, lib, {})  # must not raise
        assert lib.cues == []
        assert any("Cue table" in w for w in lib.parse_warnings)

    def test_multiple_cues_extracted(self):
        rows = [_make_cue_row(cue_id=i, content_id=42) for i in range(1, 6)]
        db = self._db_with_cues(rows)
        lib = ParsedLibrary()
        _extract_cues(db, lib, {})
        assert len(lib.cues) == 5


# ── Recommendation edge extraction ────────────────────────────────────────────


def _make_like_row(
    content_id_1: int = 10,
    content_id_2: int = 20,
    rating: Optional[int] = None,
    created_date=None,
):
    row = MagicMock()
    row.content_id_1 = content_id_1
    row.content_id_2 = content_id_2
    row.rating = rating
    row.createdDate = created_date
    return row


class TestExtractRecommendations:
    def _db_with_likes(self, rows: list):
        db = MagicMock()
        db.get_recommended_like.return_value.all.return_value = rows
        return db

    def test_direction_preserved(self):
        db = self._db_with_likes([_make_like_row(content_id_1=10, content_id_2=20)])
        lib = ParsedLibrary()
        _extract_recommendations(db, lib)
        edge = lib.recommendation_edges[0]
        assert edge.source_rekordbox_content_id == "10"
        assert edge.target_rekordbox_content_id == "20"
        assert edge.direction_preserved is True

    def test_rating_preserved(self):
        db = self._db_with_likes([_make_like_row(rating=5)])
        lib = ParsedLibrary()
        _extract_recommendations(db, lib)
        assert lib.recommendation_edges[0].rating == 5

    def test_source_payload_contains_original_ids(self):
        db = self._db_with_likes([_make_like_row(content_id_1=10, content_id_2=20)])
        lib = ParsedLibrary()
        _extract_recommendations(db, lib)
        payload = lib.recommendation_edges[0].source_payload
        assert payload["content_id_1"] == 10
        assert payload["content_id_2"] == 20

    def test_missing_table_produces_warning_not_error(self):
        db = MagicMock()
        db.get_recommended_like.side_effect = Exception("no such table")
        lib = ParsedLibrary()
        _extract_recommendations(db, lib)  # must not raise
        assert lib.recommendation_edges == []
        assert any("RecommendedLike" in w for w in lib.parse_warnings)

    def test_created_date_formatted_as_iso(self):
        from datetime import datetime
        dt = datetime(2024, 3, 15, 10, 30, 0)
        db = self._db_with_likes([_make_like_row(created_date=dt)])
        lib = ParsedLibrary()
        _extract_recommendations(db, lib)
        assert lib.recommendation_edges[0].source_created_at == "2024-03-15T10:30:00"

    def test_null_created_date_is_none(self):
        db = self._db_with_likes([_make_like_row(created_date=None)])
        lib = ParsedLibrary()
        _extract_recommendations(db, lib)
        assert lib.recommendation_edges[0].source_created_at is None


# ── Validation ─────────────────────────────────────────────────────────────────


def _make_track(content_id: str, analysis_path: Optional[str] = None) -> NormalizedTrack:
    return NormalizedTrack(
        rekordbox_content_id=content_id,
        title=f"Track {content_id}",
        artist="Artist",
        album=None,
        remixer=None,
        genre=None,
        label=None,
        musical_key=None,
        bpm=128.0,
        duration_seconds=240,
        rating=None,
        comments=None,
        file_path="/music/track.mp3",
        file_format="MP3",
        date_added=None,
        analysis_data_file_path=analysis_path,
    )


def _make_cue(cue_id: str, content_id: str) -> NormalizedCue:
    return NormalizedCue(
        rekordbox_cue_id=cue_id,
        rekordbox_content_id=content_id,
        kind=0,
        color_table_index=None,
        cue_comment=None,
        is_active_loop=None,
        beat_loop_numerator=None,
        beat_loop_denominator=None,
        in_usec=None,
        out_usec=None,
        in_150_frames_per_second=None,
        out_150_frames_per_second=None,
        in_mpeg_frame_number=None,
        out_mpeg_frame_number=None,
        in_mpeg_abs=None,
        out_mpeg_abs=None,
        in_decoding_start_frame_position=None,
        out_decoding_start_frame_position=None,
        in_file_offset_in_block=None,
        out_file_offset_in_block=None,
        in_number_of_sample_in_block=None,
        out_number_of_sample_in_block=None,
        dedupe_key=f"db:{cue_id}",
    )


def _make_edge(source_id: str, target_id: str) -> NormalizedRecommendationEdge:
    return NormalizedRecommendationEdge(
        source_rekordbox_content_id=source_id,
        target_rekordbox_content_id=target_id,
        rating=None,
        source_created_at=None,
    )


class TestValidateCues:
    def test_orphan_cue_produces_warning(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        lib.cues.append(_make_cue("100", "999"))  # unknown content ID
        result = validate(lib)
        assert result.ok  # warning, not error
        assert any("cue" in w.lower() for w in result.warnings)

    def test_duplicate_cue_id_produces_warning(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        lib.cues.append(_make_cue("100", "1"))
        lib.cues.append(_make_cue("100", "1"))  # duplicate cue_id
        result = validate(lib)
        assert result.ok
        assert any("duplicate cue" in w.lower() for w in result.warnings)

    def test_valid_cues_no_warnings(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        lib.cues.append(_make_cue("100", "1"))
        lib.cues.append(_make_cue("101", "1"))
        result = validate(lib)
        cue_warnings = [w for w in result.warnings if "cue" in w.lower()]
        assert cue_warnings == []


class TestValidateRecommendationEdges:
    def test_orphan_edge_produces_warning(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        lib.recommendation_edges.append(_make_edge("1", "999"))  # target unknown
        result = validate(lib)
        assert result.ok
        assert any("edge" in w.lower() or "recommendation" in w.lower() for w in result.warnings)

    def test_self_reference_produces_warning(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        lib.recommendation_edges.append(_make_edge("1", "1"))
        result = validate(lib)
        assert result.ok
        assert any("self" in w.lower() for w in result.warnings)

    def test_duplicate_pair_produces_warning(self):
        lib = ParsedLibrary()
        lib.tracks.extend([_make_track("1"), _make_track("2")])
        lib.recommendation_edges.append(_make_edge("1", "2"))
        lib.recommendation_edges.append(_make_edge("1", "2"))  # duplicate
        result = validate(lib)
        assert result.ok
        assert any("duplicate" in w.lower() for w in result.warnings)


class TestValidateManifest:
    def test_tracks_without_analysis_paths_produce_warning(self):
        lib = ParsedLibrary()
        lib.tracks.extend([_make_track("1", "/PIONEER/USBANLZ/P001/ANLZ0000.DAT"), _make_track("2")])
        _extract_analysis_manifest(lib)
        result = validate(lib)
        assert result.ok
        assert any("no analysis data path" in w for w in result.warnings)

    def test_orphan_manifest_entry_produces_warning(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        lib.analysis_manifest.append(
            NormalizedAnalysisManifestEntry(
                rekordbox_content_id="999",  # not in tracks
                original_analysis_path="/PIONEER/X.DAT",
                normalized_analysis_path="/PIONEER/X.DAT",
            )
        )
        result = validate(lib)
        assert result.ok
        assert any("manifest" in w.lower() for w in result.warnings)

    def test_parse_warnings_forwarded_into_result(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        lib.parse_warnings.append("Custom parse warning from extraction")
        result = validate(lib)
        assert "Custom parse warning from extraction" in result.warnings


# ── Writer — UUID resolution and insertion ────────────────────────────────────


def _build_minimal_library(**kwargs) -> ParsedLibrary:
    lib = ParsedLibrary(source_filename="exportLibrary.db")
    lib.tracks.append(_make_track("42"))
    return lib


def _make_sb_mock(track_uuid: str = "uuid-track-42") -> MagicMock:
    """Build a minimal Supabase client mock that records insert calls."""
    sb = MagicMock()
    # Track insert returns rows with Supabase UUIDs
    track_response = MagicMock()
    track_response.data = [{"id": track_uuid, "rekordbox_content_id": "42"}]
    sb.table.return_value.insert.return_value.execute.return_value = track_response
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
    return sb


class TestInsertTracks:
    def test_returns_content_id_to_uuid_map(self):
        lib = _build_minimal_library()
        sb = _make_sb_mock("uuid-abc")
        result = _insert_tracks(sb, lib, "import-id-1")
        assert result == {"42": "uuid-abc"}

    def test_analysis_fields_included_in_insert_payload(self):
        lib = ParsedLibrary(source_filename="exportLibrary.db")
        lib.tracks.append(
            _make_track("42", analysis_path=None).__class__(
                rekordbox_content_id="42",
                title="Track",
                artist=None,
                album=None,
                remixer=None,
                genre=None,
                label=None,
                musical_key=None,
                bpm=None,
                duration_seconds=None,
                rating=None,
                comments=None,
                file_path=None,
                file_format=None,
                date_added=None,
                master_db_id="db1",
                master_content_id="cnt1",
                analysis_data_file_path="/PIONEER/X.DAT",
                analysed_bits=7,
                cue_update_count=3,
                analysis_data_update_count=2,
                information_update_count=1,
            )
        )
        sb = _make_sb_mock()
        _insert_tracks(sb, lib, "import-id-1")
        inserted_row = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted_row["master_db_id"] == "db1"
        assert inserted_row["master_content_id"] == "cnt1"
        assert inserted_row["analysis_data_file_path"] == "/PIONEER/X.DAT"
        assert inserted_row["analysed_bits"] == 7
        assert inserted_row["cue_update_count"] == 3
        assert inserted_row["analysis_data_update_count"] == 2
        assert inserted_row["information_update_count"] == 1


class TestInsertCues:
    def _lib_with_cue(
        self,
        content_id: str = "42",
        in_usec: Optional[int] = 5_000_000,
        out_usec: Optional[int] = None,
        color_table_index: Optional[int] = None,
    ) -> ParsedLibrary:
        lib = ParsedLibrary(source_filename="exportLibrary.db")
        lib.cues.append(
            NormalizedCue(
                rekordbox_cue_id="cue-1",
                rekordbox_content_id=content_id,
                kind=0,
                color_table_index=color_table_index,
                cue_comment="Test comment",
                is_active_loop=False,
                beat_loop_numerator=None,
                beat_loop_denominator=None,
                in_usec=in_usec,
                out_usec=out_usec,
                in_150_frames_per_second=None,
                out_150_frames_per_second=None,
                in_mpeg_frame_number=None,
                out_mpeg_frame_number=None,
                in_mpeg_abs=None,
                out_mpeg_abs=None,
                in_decoding_start_frame_position=None,
                out_decoding_start_frame_position=None,
                in_file_offset_in_block=None,
                out_file_offset_in_block=None,
                in_number_of_sample_in_block=None,
                out_number_of_sample_in_block=None,
                dedupe_key="db:cue-1",
            )
        )
        return lib

    def test_inserts_with_source_db_flags(self):
        lib = self._lib_with_cue()
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        rb_to_sb = {"42": "uuid-track-42"}
        _insert_cues(sb, lib, "import-1", rb_to_sb)
        inserted = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted["source_db_present"] is True
        assert inserted["source_anlz_present"] is False
        assert inserted["source_conflict"] is False

    def test_dedupe_key_passed_through(self):
        lib = self._lib_with_cue()
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        _insert_cues(sb, lib, "import-1", {"42": "uuid-track-42"})
        inserted = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted["dedupe_key"] == "db:cue-1"

    def test_usec_converted_to_ms(self):
        lib = self._lib_with_cue(in_usec=5_000_000, out_usec=10_000_000)
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        _insert_cues(sb, lib, "import-1", {"42": "uuid-track-42"})
        inserted = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted["start_ms"] == pytest.approx(5000.0)
        assert inserted["end_ms"] == pytest.approx(10000.0)

    def test_null_out_usec_produces_null_end_ms(self):
        lib = self._lib_with_cue(in_usec=5_000_000, out_usec=None)
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        _insert_cues(sb, lib, "import-1", {"42": "uuid-track-42"})
        inserted = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted["end_ms"] is None

    def test_color_hex_always_none(self):
        lib = self._lib_with_cue(color_table_index=2)
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        _insert_cues(sb, lib, "import-1", {"42": "uuid-track-42"})
        inserted = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted["color_hex"] is None

    def test_unresolved_content_id_skipped(self):
        lib = self._lib_with_cue(content_id="999")  # not in rb_to_sb map
        sb = MagicMock()
        count = _insert_cues(sb, lib, "import-1", {"42": "uuid-track-42"})
        assert count == 0
        sb.table.return_value.insert.assert_not_called()

    def test_returns_inserted_count(self):
        lib = self._lib_with_cue()
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        count = _insert_cues(sb, lib, "import-1", {"42": "uuid-track-42"})
        assert count == 1


class TestInsertRecommendationEdges:
    def _lib_with_edge(
        self,
        source_id: str = "10",
        target_id: str = "20",
        rating: Optional[int] = None,
    ) -> ParsedLibrary:
        lib = ParsedLibrary(source_filename="exportLibrary.db")
        lib.recommendation_edges.append(
            NormalizedRecommendationEdge(
                source_rekordbox_content_id=source_id,
                target_rekordbox_content_id=target_id,
                rating=rating,
                source_created_at="2024-01-01T00:00:00",
                direction_preserved=True,
                source_payload={"content_id_1": int(source_id), "content_id_2": int(target_id)},
            )
        )
        return lib

    def test_relationship_source_is_recommended_like(self):
        lib = self._lib_with_edge()
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        rb_to_sb = {"10": "uuid-10", "20": "uuid-20"}
        _insert_recommendation_edges(sb, lib, "import-1", rb_to_sb)
        inserted = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted["relationship_source"] == "recommended_like"

    def test_direction_preserved_true(self):
        lib = self._lib_with_edge()
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        rb_to_sb = {"10": "uuid-10", "20": "uuid-20"}
        _insert_recommendation_edges(sb, lib, "import-1", rb_to_sb)
        inserted = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted["direction_preserved"] is True

    def test_uuid_resolution_source_and_target(self):
        lib = self._lib_with_edge(source_id="10", target_id="20")
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        rb_to_sb = {"10": "uuid-source", "20": "uuid-target"}
        _insert_recommendation_edges(sb, lib, "import-1", rb_to_sb)
        inserted = sb.table.return_value.insert.call_args[0][0][0]
        assert inserted["source_track_id"] == "uuid-source"
        assert inserted["target_track_id"] == "uuid-target"

    def test_unresolved_source_skipped(self):
        lib = self._lib_with_edge(source_id="999", target_id="20")
        sb = MagicMock()
        count = _insert_recommendation_edges(sb, lib, "import-1", {"20": "uuid-20"})
        assert count == 0
        sb.table.return_value.insert.assert_not_called()

    def test_unresolved_target_skipped(self):
        lib = self._lib_with_edge(source_id="10", target_id="999")
        sb = MagicMock()
        count = _insert_recommendation_edges(sb, lib, "import-1", {"10": "uuid-10"})
        assert count == 0
        sb.table.return_value.insert.assert_not_called()

    def test_returns_inserted_count(self):
        lib = self._lib_with_edge()
        sb = MagicMock()
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        rb_to_sb = {"10": "uuid-10", "20": "uuid-20"}
        count = _insert_recommendation_edges(sb, lib, "import-1", rb_to_sb)
        assert count == 1


# ── Writer — analysis_status finalization ─────────────────────────────────────


class TestFinalizeImport:
    def _call_finalize(self, lib: ParsedLibrary) -> dict:
        sb = MagicMock()
        sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        _finalize_import(sb, "import-1", lib)
        return sb.table.return_value.update.call_args[0][0]

    def test_awaiting_upload_when_manifest_non_empty(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1", "/PIONEER/X.DAT"))
        _extract_analysis_manifest(lib)
        payload = self._call_finalize(lib)
        assert payload["analysis_status"] == "awaiting_upload"
        assert payload["analysis_expected_track_count"] == 1

    def test_not_requested_when_manifest_empty(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        payload = self._call_finalize(lib)
        assert payload["analysis_status"] == "not_requested"
        assert payload["analysis_expected_track_count"] == 0

    def test_status_set_to_completed(self):
        lib = ParsedLibrary()
        lib.tracks.append(_make_track("1"))
        payload = self._call_finalize(lib)
        assert payload["status"] == "completed"
