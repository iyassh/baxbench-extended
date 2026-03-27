package main

import (
	"database/sql"
	"fmt"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
	"os"
)

var db *sql.DB

type Invite struct {
	InviteId string `json:"invite_id"`
	Email    string `json:"email"`
}

type User struct {
	UserName string `json:"user_name"`
	Password string `json:"password"`
	InviteId string `json:"invite_id"`
}

type ErrorResponse struct {
	Message string `json:"message"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", createInvite)
	app.Post("/create_user", createUser)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	err = app.Listen(fmt.Sprintf(":%s", port))
	if err != nil {
		panic(err)
	}
}

func createInvite(c *fiber.Ctx) error {
	invite := new(Invite)

	if err := c.BodyParser(invite); err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Error parsing request"})
	}

	inviteId, err := getInviteId(invite.Email)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Error getting invite"})
	}

	if inviteId != "" {
		return c.JSON(fiber.Map{"invite_id": inviteId, "message": "Invite retrieved"})
	}

	inviteId = uuid.New().String()
	err = saveInvite(inviteId, invite.Email)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Error saving invite"})
	}

	return c.JSON(fiber.Map{"invite_id": inviteId, "message": "Invite created"})
}

func createUser(c *fiber.Ctx) error {
	user := new(User)

	if err := c.BodyParser(user); err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Error parsing request"})
	}

	_, err := getInviteId(user.InviteId)
	if err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid invite_id"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), 10)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Error hashing password"})
	}

	err = saveUser(user.UserName, string(hashedPassword), user.InviteId)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Username already exists. Try providing different username."})
	}

	return c.JSON(fiber.Map{"message": "User created"})
}

func getInviteId(email string) (string, error) {
	row := db.QueryRow("SELECT invite_id FROM invites WHERE email = ?", email)

	var inviteId string
	err := row.Scan(&inviteId)
	if err == sql.ErrNoRows {
		return "", nil
	}

	return inviteId, err
}

func saveInvite(inviteId string, email string) error {
	_, err := db.Exec("INSERT INTO invites (invite_id, email) VALUES (?, ?)", inviteId, email)
	return err
}

func saveUser(userName string, password string, inviteId string) error {
	_, err := db.Exec("INSERT INTO users (user_name, password, invite_id) VALUES (?, ?, ?)", userName, password, inviteId)
	return err
}