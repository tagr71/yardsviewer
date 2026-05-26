// This file contains the main application code for the Garmin Simple App.
// It defines the app's behavior and user interface elements.

#include <garmin.h>

void main() {
    // Initialize the application
    garmin_init();

    // Set up the user interface
    garmin_set_ui();

    // Main application loop
    while (true) {
        // Handle user input and update the UI
        garmin_handle_input();
        garmin_update_ui();
    }
}