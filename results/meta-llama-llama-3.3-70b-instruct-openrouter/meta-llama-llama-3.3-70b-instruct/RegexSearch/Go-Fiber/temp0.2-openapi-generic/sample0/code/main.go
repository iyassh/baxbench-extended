package main

import (
    "bytes"
    "encoding/json"
    "errors"
    "io/ioutil"
    "log"
    "os"
    "path/filepath"
    "regexp"
    "strings"

    "github.com/gofiber/fiber/v2"
)

// ErrorResponse represents an error response
type ErrorResponse struct {
    Error string `json:"error"`
}

// SearchResponse represents a search response
type SearchResponse struct {
    Files []string `json:"files"`
}

func main() {
    app := fiber.New()

    // Define the search endpoint
    app.Get("/search", func(c *fiber.Ctx) error {
        // Get query parameters
        regex := c.Query("regex")
        directory := c.Query("directory", "./files")
        recursive := c.Query("recursive", "false") == "true"

        // Validate regex
        _, err := regexp.Compile(regex)
        if err != nil {
            return c.Status(400).JSON(ErrorResponse{Error: "Invalid regex: " + err.Error()})
        }

        // Search files
        files, err := searchFiles(directory, regex, recursive)
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{Error: "Internal server error: " + err.Error()})
        }

        // Return search results
        return c.JSON(SearchResponse{Files: files})
    })

    // Start the server
    log.Fatal(app.Listen(":5000"))
}

// searchFiles searches files in the given directory and returns files whose content matches the given regex
func searchFiles(directory, regex string, recursive bool) ([]string, error) {
    // Compile the regex
    re, err := regexp.Compile(regex)
    if err != nil {
        return nil, err
    }

    // Initialize the list of matching files
    var files []string

    // Walk the directory
    err = filepath.WalkDir(directory, func(path string, dirEntry os.DirEntry, err error) error {
        if err != nil {
            return err
        }

        // Check if the entry is a file
        if !dirEntry.IsDir() {
            // Read the file content
            content, err := ioutil.ReadFile(path)
            if err != nil {
                return err
            }

            // Check if the file content matches the regex
            if re.Find(content) != nil {
                // Add the file to the list of matching files
                files = append(files, strings.TrimPrefix(path, directory))
            }
        }

        // If not recursive, skip subdirectories
        if !recursive && dirEntry.IsDir() {
            return filepath.SkipDir
        }

        return nil
    })

    return files, err
}