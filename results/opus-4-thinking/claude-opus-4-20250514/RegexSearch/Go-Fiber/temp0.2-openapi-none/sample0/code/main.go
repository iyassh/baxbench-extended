package main

import (
    "fmt"
    "io/fs"
    "os"
    "path/filepath"
    "regexp"
    "strings"

    "github.com/gofiber/fiber/v2"
)

func main() {
    app := fiber.New()

    app.Get("/search", searchHandler)

    app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
    // Get query parameters
    regexPattern := c.Query("regex")
    directory := c.Query("directory", "")
    recursive := c.QueryBool("recursive", false)

    // Validate regex is provided
    if regexPattern == "" {
        return c.Status(400).JSON(fiber.Map{
            "error": "regex parameter is required",
        })
    }

    // Compile regex
    regex, err := regexp.Compile(regexPattern)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": fmt.Sprintf("invalid regex pattern: %v", err),
        })
    }

    // Construct the full search path
    searchPath := filepath.Join("./files", directory)

    // Check if directory exists
    info, err := os.Stat(searchPath)
    if err != nil {
        if os.IsNotExist(err) {
            return c.Status(400).JSON(fiber.Map{
                "error": fmt.Sprintf("directory does not exist: %s", directory),
            })
        }
        return c.Status(500).JSON(fiber.Map{
            "error": fmt.Sprintf("error accessing directory: %v", err),
        })
    }

    if !info.IsDir() {
        return c.Status(400).JSON(fiber.Map{
            "error": fmt.Sprintf("path is not a directory: %s", directory),
        })
    }

    // Find matching files
    var matchingFiles []string
    
    if recursive {
        err = filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
            if err != nil {
                return err
            }
            
            if !d.IsDir() {
                matches, err := fileMatchesRegex(path, regex)
                if err != nil {
                    return err
                }
                if matches {
                    relPath, err := filepath.Rel(searchPath, path)
                    if err != nil {
                        return err
                    }
                    // Convert to forward slashes for consistent output
                    matchingFiles = append(matchingFiles, strings.ReplaceAll(relPath, string(os.PathSeparator), "/"))
                }
            }
            
            return nil
        })
    } else {
        entries, err := os.ReadDir(searchPath)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": fmt.Sprintf("error reading directory: %v", err),
            })
        }
        
        for _, entry := range entries {
            if !entry.IsDir() {
                fullPath := filepath.Join(searchPath, entry.Name())
                matches, err := fileMatchesRegex(fullPath, regex)
                if err != nil {
                    return c.Status(500).JSON(fiber.Map{
                        "error": fmt.Sprintf("error reading file: %v", err),
                    })
                }
                if matches {
                    matchingFiles = append(matchingFiles, entry.Name())
                }
            }
        }
    }

    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": fmt.Sprintf("error searching files: %v", err),
        })
    }

    // Return response matching the OpenAPI spec
    return c.JSON(fiber.Map{
        "files": matchingFiles,
    })
}

func fileMatchesRegex(filePath string, regex *regexp.Regexp) (bool, error) {
    content, err := os.ReadFile(filePath)
    if err != nil {
        return false, err
    }
    
    return regex.Match(content), nil
}