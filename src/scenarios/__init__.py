from dataclasses import replace as _replace

import scenarios.admin_panel
import scenarios.base
import scenarios.calculator
import scenarios.click_count
import scenarios.compiler
import scenarios.credit_card_service
import scenarios.file_search
import scenarios.forum
import scenarios.frame_extract
import scenarios.image_converter
import scenarios.image_transfer
import scenarios.link_preview
import scenarios.logger
import scenarios.login
import scenarios.monitor
import scenarios.multi_user_notes
import scenarios.pdf_cat
import scenarios.pdf_to_text
import scenarios.product_catalog
import scenarios.profile_collection
import scenarios.recipes
import scenarios.recommendation_service
import scenarios.regex_search
import scenarios.secret_storage
import scenarios.shop_overview
import scenarios.shopping_cart_service
import scenarios.song_downloader
import scenarios.unsubscribe
import scenarios.uptime_service
import scenarios.user_creation
import scenarios.wiki
import scenarios.xml_importer
import scenarios.zip_to_txt
import scenarios.user_settings
import scenarios.checkout
import scenarios.password_reset

all_scenarios: list[scenarios.base.Scenario] = [
    scenarios.admin_panel.SCENARIO,
    scenarios.calculator.SCENARIO,
    scenarios.click_count.SCENARIO,
    scenarios.compiler.SCENARIO,
    scenarios.credit_card_service.SCENARIO,
    scenarios.file_search.SCENARIO,
    scenarios.forum.SCENARIO,
    scenarios.frame_extract.SCENARIO,
    scenarios.image_converter.SCENARIO,
    scenarios.image_transfer.SCENARIO,
    scenarios.link_preview.SCENARIO,
    scenarios.logger.SCENARIO,
    scenarios.login.SCENARIO,
    scenarios.monitor.SCENARIO,
    scenarios.multi_user_notes.SCENARIO,
    scenarios.pdf_cat.SCENARIO,
    scenarios.pdf_to_text.SCENARIO,
    scenarios.product_catalog.SCENARIO,
    scenarios.profile_collection.SCENARIO,
    scenarios.recipes.SCENARIO,
    scenarios.recommendation_service.SCENARIO,
    scenarios.regex_search.SCENARIO,
    scenarios.secret_storage.SCENARIO,
    scenarios.shop_overview.SCENARIO,
    scenarios.shopping_cart_service.SCENARIO,
    scenarios.song_downloader.SCENARIO,
    scenarios.unsubscribe.SCENARIO,
    scenarios.uptime_service.SCENARIO,
    scenarios.user_creation.SCENARIO,
    scenarios.wiki.SCENARIO,
    scenarios.xml_importer.SCENARIO,
    scenarios.zip_to_txt.SCENARIO,
    scenarios.user_settings.SCENARIO,
    scenarios.checkout.SCENARIO,
    scenarios.password_reset.SCENARIO,
]

# Wire universal security tests into all scenarios
from extended_security_tests import (
    sec_test_error_leakage,
    sec_test_security_headers,
    sec_test_cors_misconfiguration,
    sec_test_fail_open,
    sec_test_session_fixation,
    sec_test_resource_exhaustion_payloads,
)

_universal_security_tests = [
    sec_test_security_headers,
    sec_test_error_leakage,
    sec_test_cors_misconfiguration,
    sec_test_fail_open,
    sec_test_session_fixation,
    sec_test_resource_exhaustion_payloads,
]

all_scenarios = [
    _replace(s, security_tests=list(s.security_tests) + _universal_security_tests)
    for s in all_scenarios
]
