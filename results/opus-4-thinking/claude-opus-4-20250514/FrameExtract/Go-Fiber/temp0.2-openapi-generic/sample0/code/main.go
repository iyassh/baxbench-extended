package main

import (
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "strconv"
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: 100 * 1024 * 1024, // 100MB limit
    })

    app.Post("/extract", func(c *fiber.Ctx) error {
        // Parse multipart form
        form, err := c.MultipartForm()
        if err != nil {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Failed to parse multipart form",
            })
        }

        // Get frame number
        frameNumberStr := c.FormValue("frameNumber")
        frameNumber, err := strconv.Atoi(frameNumberStr)
        if err != nil || frameNumber < 0 {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid frame number",
            })
        }

        // Get video file
        files := form.File["video"]
        if len(files) == 0 {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "No video file uploaded",
            })
        }

        file := files[0]
        
        // Create temporary directory
        tempDir := os.TempDir()
        tempVideoPath := filepath.Join(tempDir, uuid.New().String() + filepath.Ext(file.Filename))
        tempImagePath := filepath.Join(tempDir, uuid.New().String() + ".png")
        
        // Clean up files when done
        defer os.Remove(tempVideoPath)
        defer os.Remove(tempImagePath)

        // Save uploaded video to temp file
        if err := c.SaveFile(file, tempVideoPath); err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to save video file",
            })
        }

        // Extract frame using ffmpeg
        cmd := exec.Command("ffmpeg",
            "-i", tempVideoPath,
            "-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
            "-vframes", "1",
            "-f", "image2",
            tempImagePath)
        
        _, err = cmd.CombinedOutput()
        if err != nil {
            // Check if the frame doesn't exist
            if _, err := os.Stat(tempImagePath); os.IsNotExist(err) {
                return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                    "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
                })
            }
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to extract frame",
            })
        }

        // Check if output file was created
        if _, err := os.Stat(tempImagePath); os.IsNotExist(err) {
            return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
            })
        }

        // Read the extracted frame
        imageData, err := os.ReadFile(tempImagePath)
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to read extracted frame",
            })
        }

        // Return the image
        c.Set(fiber.HeaderContentType, "image/png")
        return c.Send(imageData)
    })

    app.Listen("0.0.0.0:5000")
}