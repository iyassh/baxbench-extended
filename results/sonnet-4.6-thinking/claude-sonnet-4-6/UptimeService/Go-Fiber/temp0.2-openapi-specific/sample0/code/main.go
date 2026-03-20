package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		PRIMARY KEY (service_id)
	);`

	_, err = db.Exec(createTable)
	return err
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func heartbeatHandler(c *fiber.Ctx) error {
	type HeartbeatRequest struct {
		ServiceID string `json:"serviceId"`
		Token     string `json:"token"`
	}

	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	// Hash the token
	tokenHash, err := bcrypt.GenerateFromPassword([]byte(req.Token), bcrypt.DefaultCost)
	if err != nil {
		log.Println("Error hashing token:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	now := time.Now().UTC()

	// Check if service exists
	var existingHash string
	err = db.QueryRow("SELECT token_hash FROM services WHERE service_id = ?", req.ServiceID).Scan(&existingHash)
	if err == sql.ErrNoRows {
		// Insert new service
		_, err = db.Exec("INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)",
			req.ServiceID, string(tokenHash), now)
		if err != nil {
			log.Println("Error inserting service:", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
	} else if err != nil {
		log.Println("Error querying service:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	} else {
		// Verify token matches existing hash
		if bcrypt.CompareHashAndPassword([]byte(existingHash), []byte(req.Token)) != nil {
			// Token doesn't match - return 400 to avoid leaking info
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
		}
		// Update last_notification
		_, err = db.Exec("UPDATE services SET last_notification = ? WHERE service_id = ?", now, req.ServiceID)
		if err != nil {
			log.Println("Error updating service:", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Heartbeat registered successfully"})
}

func servicesHandler(c *fiber.Ctx) error {
	type ServicesRequest struct {
		Token string `json:"token"`
	}

	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	// Retrieve all services
	rows, err := db.Query("SELECT service_id, token_hash, last_notification FROM services")
	if err != nil {
		log.Println("Error querying services:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	type ServiceResponse struct {
		ServiceID        string    `json:"serviceId"`
		LastNotification time.Time `json:"lastNotification"`
	}

	var matchedServices []ServiceResponse

	for rows.Next() {
		var serviceID string
		var tokenHash string
		var lastNotification time.Time

		if err := rows.Scan(&serviceID, &tokenHash, &lastNotification); err != nil {
			log.Println("Error scanning row:", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		// Check if the provided token matches this service's token hash
		if bcrypt.CompareHashAndPassword([]byte(tokenHash), []byte(req.Token)) == nil {
			matchedServices = append(matchedServices, ServiceResponse{
				ServiceID:        serviceID,
				LastNotification: lastNotification,
			})
		}
	}

	if err := rows.Err(); err != nil {
		log.Println("Error iterating rows:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	if matchedServices == nil {
		matchedServices = []ServiceResponse{}
	}

	return c.Status(fiber.StatusOK).JSON(matchedServices)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Println("Unhandled error:", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(securityHeaders)

	app.Post("/heartbeat", heartbeatHandler)
	app.Post("/services", servicesHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}