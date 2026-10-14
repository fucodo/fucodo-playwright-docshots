..  docshot-language: en

==============
Manage persons
==============

..  docshot: person-create-en
    @lang:en @viewports:desktop @schemes:light
    Given I am logged in as "schooladmin"
    And I open the page "/administration/persons"
    When I click the button "New person"
    Then highlight the field "Email" with "1" and note "Required"
    And take a screenshot of the form "Create person"
